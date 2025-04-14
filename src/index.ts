import { Client, Events, GatewayIntentBits, Message, Partials, ChannelType, ThreadChannel, TextChannel } from 'discord.js'
import { setTimeout } from 'timers/promises'
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { createSession, sendMessage, getSessionDetails, SessionDetailsResponse } from './lib/devinClient' // Devin API クライアントをインポート
import { inspect } from 'util' // structured_output の表示に使用

// --- 定数 ---
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const SESSIONS_TABLE_NAME = process.env.SESSIONS_TABLE_NAME // CDKから渡されるテーブル名
const ASIDE_KEYWORD = 'aside' // 無視するキーワード
const MUTE_KEYWORD = 'mute'
const UNMUTE_KEYWORD = 'unmute'
const POLLING_INTERVAL_MS = 15 * 1000 // 15秒ごとにポーリング (Devin ドキュメント推奨 10-30秒)
const TERMINAL_SESSION_STATES = ['blocked', 'stopped', 'finished', 'suspended'] // ポーリングを停止するステータス

// --- 状態管理 ---

interface MonitoringState {
  intervalId: NodeJS.Timeout
  lastStatus: string | null
  lastStructuredOutput: any | null
  threadId: string // スレッドIDも保持
}
const activeMonitoring = new Map<string, MonitoringState>()

// --- 環境変数チェック ---
if (!DISCORD_BOT_TOKEN) {
  console.error('環境変数 DISCORD_BOT_TOKEN が設定されていません。')
  process.exit(1)
}
if (!SESSIONS_TABLE_NAME) { // 追加
  console.error('環境変数 SESSIONS_TABLE_NAME が設定されていません。')
  process.exit(1)
}

// --- AWS SDK 初期化 --- // 追加
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// --- Discord クライアント初期化 ---
console.log('Initializing Discord client...')
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,      // サーバーに関する情報
    GatewayIntentBits.GuildMessages, // サーバー内のメッセージ
    GatewayIntentBits.MessageContent // メッセージの内容 (特権インテント)
    // 必要に応じて他のインテントを追加
  ],
  // Partialを有効にして、キャッシュされていないメッセージでもイベントを受け取れるようにする
  partials: [Partials.Message, Partials.Channel]
})

// --- ヘルパー関数 ---

/**
 * 指定されたスレッドのセッション情報（セッションIDとミュート状態）を取得します。
 * @param threadId スレッドID
 * @returns セッション情報、または見つからない場合は undefined
 */
async function getSessionInfoFromDb(threadId: string): Promise<{ sessionId: string, muted: boolean } | undefined> {
  try {
    const command = new GetCommand({
      TableName: SESSIONS_TABLE_NAME,
      Key: { threadId },
    })
    const { Item } = await docClient.send(command)
    if (Item && Item.sessionId) {
      return { sessionId: Item.sessionId, muted: Item.muted ?? false } // muted がなければ false
    } else {
      console.warn(`Session info not found in DB for thread ${threadId}`)
      return undefined
    }
  } catch (error) {
    console.error(`Error getting session info from DynamoDB for thread ${threadId}:`, error)
    return undefined // エラー時も undefined を返す
  }
}

/**
 * 指定された Discord スレッドにメッセージを送信します。
 * スレッドが見つからない場合やミュートされている場合は送信しません。
 * @param threadId 送信先のスレッド ID
 * @param content 送信するメッセージ内容
 */
async function sendToThread(threadId: string, content: string) {
  // ★★ DynamoDBからミュート状態を取得 ★★
  const sessionInfo = await getSessionInfoFromDb(threadId)
  if (sessionInfo?.muted) { // muted が true の場合
    console.log(`[Muted] Suppressing message send to thread ${threadId}`)
    return // ミュート中は送信しない
  }

  // セッション情報がない場合も送信しない（エラーログは getSessionInfoFromDb で出力済み）
  if (!sessionInfo) {
    return
  }

  try {
    const channel = await client.channels.fetch(threadId)
    if (channel?.isThread()) {
      await channel.send(content)
    } else {
      console.error(`Thread channel not found or invalid: ${threadId}`)
    }
  } catch (error) {
    console.error(`Failed to send message to thread ${threadId}:`, error)
  }
}

// --- セッション監視関数 ---

/**
 * 指定された Devin セッションの監視を開始します。
 * @param sessionId 監視対象のセッション ID
 * @param threadId 対応する Discord スレッド ID
 */
async function startSessionMonitoring(sessionId: string, threadId: string) {
  console.log(`Starting monitoring for session ${sessionId} (Thread: ${threadId})`)
  try {
    const initialDetails = await getSessionDetails(sessionId)
    const initialState: MonitoringState = {
      intervalId: setInterval(() => pollSessionStatus(sessionId), POLLING_INTERVAL_MS),
      lastStatus: initialDetails.status_enum,
      lastStructuredOutput: initialDetails.structured_output,
      threadId: threadId,
    }
    activeMonitoring.set(sessionId, initialState)
    console.log(`Initial status for ${sessionId}: ${initialState.lastStatus}`)

  } catch (error) {
    // ★★ エラーハンドリング改善 ★★
    console.error(`[Error] Failed to get initial session details for ${sessionId} in startSessionMonitoring:`, extractApiError(error))
    // ユーザーへの通知は維持
    await sendToThread(threadId, `❌ セッション (${sessionId}) の初期状態取得に失敗し、監視を開始できませんでした。`)
  }
}

/**
 * 指定された Devin セッションの状態をポーリングし、変更があれば通知します。
 * @param sessionId ポーリング対象のセッション ID
 */
async function pollSessionStatus(sessionId: string) {
  const monitoringState = activeMonitoring.get(sessionId)
  if (!monitoringState) {
    console.warn(`Polling attempted for inactive session ${sessionId}. Stopping interval.`)
    return
  }

  // ★★ スレッドIDを monitoringState から取得 ★★
  const threadId = monitoringState.threadId

  // ★★ DynamoDBからミュート状態を取得 ★★
  const sessionInfo = await getSessionInfoFromDb(threadId)
  const isMuted = sessionInfo?.muted ?? false // セッション情報がなくてもミュート扱いにはしない

  try {
    const currentDetails = await getSessionDetails(sessionId)
    const newStatus = currentDetails.status_enum
    const newOutput = currentDetails.structured_output

    // 1. ステータス変更の確認と通知 (ミュート時はスキップ)
    if (newStatus !== monitoringState.lastStatus) {
      console.log(`Status changed for session ${sessionId}: ${monitoringState.lastStatus} -> ${newStatus}`)
      if (!isMuted) {
        await sendToThread(
          threadId, // monitoringState.threadId を使用
          `ステータスが変更されました: **${newStatus ?? '不明'}**`
        )
      } else {
        console.log(`[Muted] Suppressed status change notification for thread ${threadId}`)
      }
      monitoringState.lastStatus = newStatus
    }

    // 2. Structured Output 全体の変更を確認と通知 (ミュート時はスキップ)
    if (newOutput && inspect(newOutput) !== inspect(monitoringState.lastStructuredOutput)) {
      console.log(`Structured output changed for session ${sessionId}`)
      if (!isMuted) {
        const outputString = JSON.stringify(newOutput, null, 2)
        const truncatedOutput = outputString.length > 1800 ? outputString.substring(0, 1797) + '...' : outputString
        await sendToThread(
          threadId, // monitoringState.threadId を使用
          `構造化出力が更新されました:\n\`\`\`json\n${truncatedOutput}\n\`\`\``
        )
      } else {
        console.log(`[Muted] Suppressed structured output notification for thread ${threadId}`)
      }
      monitoringState.lastStructuredOutput = newOutput
    }

    // 3. 終了状態か確認 (通知はミュート時スキップ、監視停止は行う)
    if (newStatus && TERMINAL_SESSION_STATES.includes(newStatus)) {
      console.log(`Session ${sessionId} reached terminal state: ${newStatus}. Logging full response and stopping monitoring.`)
      console.log('Full API Response:', JSON.stringify(currentDetails, null, 2))
      if (!isMuted) {
        await sendToThread(
          threadId, // monitoringState.threadId を使用
          `セッションは状態「**${newStatus}**」で終了しました。監視を停止します。`
        )
      } else {
        console.log(`[Muted] Suppressed session termination notification for thread ${threadId}`)
      }
      stopSessionMonitoring(sessionId) // 監視停止は行う
    }

  } catch (error) {
    // ★★ エラーハンドリング改善 ★★
    console.error(`[Error] Error polling session ${sessionId} in pollSessionStatus:`, extractApiError(error))
    // ユーザーへの通知は維持 (ミュート時以外)
    if (!isMuted) {
      await sendToThread(
        threadId,
        `❌ セッション (${sessionId}) の状態取得中にエラーが発生しました。監視を停止します。`
      )
    }
    stopSessionMonitoring(sessionId) // エラー時も監視停止
  }
}

/**
 * 指定された Devin セッションの監視を停止します。
 * @param sessionId 監視を停止するセッション ID
 */
function stopSessionMonitoring(sessionId: string) {
  const monitoringState = activeMonitoring.get(sessionId)
  if (monitoringState) {
    clearInterval(monitoringState.intervalId)
    activeMonitoring.delete(sessionId)
    console.log(`Stopped monitoring for session ${sessionId}`)
  } else {
    console.warn(`Attempted to stop monitoring for inactive session ${sessionId}`)
  }
}

// --- イベントハンドラ ---

// Bot 準備完了時
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Ready! Logged in as ${readyClient.user.tag}`)
  // ここで初期化処理などを行う (例: スラッシュコマンド登録)
})

// メッセージ作成時
client.on(Events.MessageCreate, async (message: Message) => {
  // Bot や自身のメッセージは無視
  if (message.author.bot || message.author.id === client.user?.id) {
    return
  }

  // 1. 通常チャンネルでのメンション処理
  if (message.mentions.has(client.user!) && !message.mentions.everyone && message.channel.type === ChannelType.GuildText) {
    console.log(`Mention detected from ${message.author.tag} in channel ${message.channel.name}`)

    const prompt = message.content.replace(/<@!?\d+>/g, '').trim()
    if (!prompt) {
      await message.reply('Devin に伝える内容をメンションに続けて入力してください。')
      return
    }

    let thread: ThreadChannel | undefined
    try {
      console.log(`Creating Devin session with prompt: "${prompt}"`)
      const sessionResponse = await createSession({ prompt })
      console.log(`Devin session created: ${sessionResponse.session_id}, URL: ${sessionResponse.url}`)

      const threadName = prompt.length > 50 ? prompt.substring(0, 47) + '...' : prompt
      thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: 60,
      })
      console.log(`Discord thread created: ${thread.id} (${thread.name})`)

      // ★★ DynamoDB にセッション情報を保存 ★★
      try {
        const putCommand = new PutCommand({
          TableName: SESSIONS_TABLE_NAME,
          Item: {
            threadId: thread.id,
            sessionId: sessionResponse.session_id,
            muted: false, // 初期状態はミュート解除
            createdAt: new Date().toISOString(),
          },
        })
        await docClient.send(putCommand)
        console.log(`Stored session mapping in DB: ${thread.id} -> ${sessionResponse.session_id}`)
      } catch (dbError) {
        console.error(`Failed to store session mapping in DynamoDB for thread ${thread.id}:`, dbError)
        await thread.send('⚠️ セッション情報のデータベースへの保存に失敗しました。一部機能が動作しない可能性があります。')
        // DB保存失敗しても処理は続行する（監視は開始される）
      }

      await thread.send(
        `Devin セッションを開始しました。
セッション ID: ${sessionResponse.session_id}
進捗はこちらで確認できます: ${sessionResponse.url}

このスレッド内で Devin への指示を送信してください。
(メッセージの先頭に \`${ASIDE_KEYWORD}\` と付けると Devin には送られません)
(このスレッドへの通知を止めるには \`${MUTE_KEYWORD}\` 、再開するには \`${UNMUTE_KEYWORD}\`)` // Mute/Unmute の説明追加
      )
      console.log(`Sent initial message to thread ${thread.id}`)

      await startSessionMonitoring(sessionResponse.session_id, thread.id)

    } catch (error) {
      // ★★ エラーハンドリング改善 ★★
      console.error('[Error] Error processing mention:', extractApiError(error))
      const userFriendlyError = getUserFriendlyErrorMessage(error)
      // ユーザーへの通知は維持
      try {
        const replyContent = `Devin セッションの開始またはスレッドの作成に失敗しました。
エラー: ${userFriendlyError}`
        if (thread) {
          await thread.send(replyContent)
        } else {
          await message.reply(replyContent)
        }
      } catch (replyError) {
        console.error('Failed to send error message to Discord:', replyError)
      }
    }
    return // メンション処理が終わったら以降は処理しない
  }

  // 2. Bot が作成したスレッド内のメッセージ処理
  if (message.channel.isThread() && message.channel.ownerId === client.user?.id) {
    const threadId = message.channelId

    // ★★ DynamoDBからセッション情報を取得 ★★
    const sessionInfo = await getSessionInfoFromDb(threadId)
    if (!sessionInfo) {
      // DBに情報がない場合は無視（セッション開始失敗などのケース）
      console.warn(`Session info not found for thread ${threadId} in DB. Ignoring message.`)
      return
    }
    const { sessionId, muted } = sessionInfo

    const lowerContent = message.content.trim().toLowerCase()

    // ★★ Mute/Unmute コマンドを DynamoDB 反映 ★★
    if (lowerContent === MUTE_KEYWORD || lowerContent === UNMUTE_KEYWORD) {
      const shouldMute = lowerContent === MUTE_KEYWORD
      if (muted === shouldMute) {
        await message.reply(shouldMute ? '🔇 このスレッドは既にミュートされています。' : '🔊 このスレッドはミュートされていません。')
        return
      }

      try {
        const updateCommand = new UpdateCommand({
          TableName: SESSIONS_TABLE_NAME,
          Key: { threadId },
          UpdateExpression: 'set muted = :m',
          ExpressionAttributeValues: {
            ':m': shouldMute,
          },
          ReturnValues: 'NONE',
        })
        await docClient.send(updateCommand)
        console.log(`Thread ${threadId} ${shouldMute ? 'muted' : 'unmuted'} in DB.`)
        await message.reply(shouldMute ? '🔇 このスレッドでの Devin からの通知をミュートしました。' : '🔊 このスレッドのミュートを解除しました。')
      } catch (dbError) {
        console.error(`Failed to update mute status in DynamoDB for thread ${threadId}:`, dbError)
        await message.reply('❌ ミュート状態の更新に失敗しました。')
      }
      return // Mute/Unmute コマンド自体は Devin に送らない
    }

    // Aside キーワード
    if (lowerContent.startsWith(ASIDE_KEYWORD)) {
      console.log(`Aside message detected in thread ${threadId}. Ignoring.`)
      return // aside メッセージは Devin に送らない
    }

    // ミュート中のメッセージ転送スキップ
    if (muted) {
      console.log(`[Muted] Suppressing message send from thread ${threadId} to session ${sessionId}`)
      return
    }

    try {
      console.log(`Sending message from thread ${threadId} to session ${sessionId}: "${message.content}"`)
      await sendMessage(sessionId, { message: message.content })
    } catch (error) {
      // ★★ エラーハンドリング改善 ★★
      console.error(`[Error] Error sending message to Devin session ${sessionId}:`, extractApiError(error))
      const userFriendlyError = getUserFriendlyErrorMessage(error)
      // ユーザーへの通知は維持
      try {
        await message.reply(`Devin へのメッセージ送信に失敗しました。
エラー: ${userFriendlyError}`)
      } catch (replyError) {
        console.error('Failed to send error reply to Discord thread:', replyError)
      }
    }
  }
})

// --- 接続 ---

async function connectDiscord() {
  try {
    console.log('Logging in to Discord...')
    await client.login(DISCORD_BOT_TOKEN)
    console.log('Successfully logged in.')
  } catch (error) {
    console.error('Failed to log in to Discord:', error)
    // 必要に応じてリトライ処理などを追加
    await setTimeout(5000) // 5秒待って再試行
    await connectDiscord()
  }
}

// --- 起動 ---
connectDiscord()

// --- エラーハンドリング & シャットダウン ---
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error)
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Stopping all monitoring and shutting down.')
  activeMonitoring.forEach((_, sessionId) => {
    stopSessionMonitoring(sessionId)
  })
  client.destroy()
  process.exit(0)
});

// --- 新しいヘルパー関数 (エラー抽出) ---

/**
 * Axiosエラーオブジェクトから主要な情報を抽出して返します。
 * Axiosエラーでない場合は、エラーオブジェクト自体を返します。
 * @param error 補足されたエラーオブジェクト
 * @returns 抽出されたエラー情報または元のエラーオブジェクト
 */
function extractApiError(error: any): any {
  if (error.isAxiosError) {
    return {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data,
      requestUrl: error.config?.url,
      requestMethod: error.config?.method,
    }
  }
  return error // Axios エラーでなければそのまま返す
}

/**
 * ユーザーに表示するための、より分かりやすいエラーメッセージを取得します。
 * @param error 補足されたエラーオブジェクト
 * @returns ユーザーフレンドリーなエラーメッセージ文字列
 */
function getUserFriendlyErrorMessage(error: any): string {
  if (error.isAxiosError && error.response) {
    // APIからのエラーレスポンスがある場合
    const status = error.response.status
    const data = error.response.data
    let detailMessage = '不明なAPIエラー'
    if (data && typeof data === 'object' && data.detail) {
      detailMessage = data.detail // Devin API が返す詳細メッセージを使用
    } else if (typeof data === 'string') {
      detailMessage = data
    }
    return `APIエラー (${status}): ${detailMessage}`
  } else if (error instanceof Error) {
    // 一般的なJavaScriptエラーの場合
    return error.message
  }
  // その他の予期せぬエラー
  return '不明なエラーが発生しました。'
}
