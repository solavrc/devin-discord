import { Client, Events, GatewayIntentBits, Message, Partials, ChannelType, ThreadChannel, TextChannel } from 'discord.js'
import { setTimeout } from 'timers/promises'
import { createSession, sendMessage, getSessionDetails, SessionDetailsResponse } from './lib/devinClient' // Devin API クライアントをインポート
import { inspect } from 'util' // structured_output の表示に使用

// --- 定数 ---
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const ASIDE_KEYWORD = 'aside' // 無視するキーワード
const MUTE_KEYWORD = 'mute'
const UNMUTE_KEYWORD = 'unmute'
const POLLING_INTERVAL_MS = 15 * 1000 // 15秒ごとにポーリング (Devin ドキュメント推奨 10-30秒)
const TERMINAL_SESSION_STATES = ['blocked', 'stopped', 'finished', 'suspended'] // ポーリングを停止するステータス

// --- 状態管理 (一時的) ---
// Discord スレッド ID と Devin セッション ID のマッピング (フェーズ2で永続化)
const threadSessionMap = new Map<string, string>()
// ★★ ミュート状態のスレッド ID を管理 (インメモリ) ★★
const mutedThreads = new Set<string>()
// アクティブなセッション監視の状態
interface MonitoringState {
  intervalId: NodeJS.Timeout
  lastStatus: string | null
  lastStructuredOutput: any | null
  threadId: string
}
const activeMonitoring = new Map<string, MonitoringState>()

// --- 環境変数チェック ---
if (!DISCORD_BOT_TOKEN) {
  console.error('環境変数 DISCORD_BOT_TOKEN が設定されていません。')
  process.exit(1)
}

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
 * 指定された Discord スレッドにメッセージを送信します。
 * スレッドが見つからない場合はエラーをログに出力します。
 * @param threadId 送信先のスレッド ID
 * @param content 送信するメッセージ内容
 */
async function sendToThread(threadId: string, content: string) {
  // ★★ ミュートチェックを追加 ★★
  if (mutedThreads.has(threadId)) {
    console.log(`[Muted] Suppressing message send to thread ${threadId}`)
    return // ミュート中は送信しない
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

    // 初回ステータスをスレッドに通知 (任意)
    // await sendToThread(threadId, `👀 セッションの監視を開始しました。現在のステータス: ${initialState.lastStatus ?? '不明'}`)

  } catch (error) {
    console.error(`Failed to start monitoring for session ${sessionId}:`, error)
    await sendToThread(threadId, `❌ セッション (${sessionId}) の監視開始に失敗しました。`)
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
    // 念のためインターバルを停止しようとするが、ID が不明なためここではできない
    return
  }

  // ★★ ミュートチェックを追加 (ポーリング自体は続けるが通知を抑制) ★★
  const isMuted = mutedThreads.has(monitoringState.threadId)

  try {
    const currentDetails = await getSessionDetails(sessionId)
    const newStatus = currentDetails.status_enum
    const newOutput = currentDetails.structured_output

    // 1. ステータス変更の確認と通知 (ミュート時はスキップ)
    if (newStatus !== monitoringState.lastStatus) {
      console.log(`Status changed for session ${sessionId}: ${monitoringState.lastStatus} -> ${newStatus}`)
      if (!isMuted) {
        await sendToThread(
          monitoringState.threadId,
          `ステータスが変更されました: **${newStatus ?? '不明'}**`
        )
      } else {
        console.log(`[Muted] Suppressed status change notification for thread ${monitoringState.threadId}`)
      }
      monitoringState.lastStatus = newStatus
    }

    // ★★ 2. Structured Output 全体の変更を確認と通知 (シンプルに戻す) ★★
    if (newOutput && inspect(newOutput) !== inspect(monitoringState.lastStructuredOutput)) {
      console.log(`Structured output changed for session ${sessionId}`)
      if (!isMuted) {
        const outputString = JSON.stringify(newOutput, null, 2)
        const truncatedOutput = outputString.length > 1800 ? outputString.substring(0, 1797) + '...' : outputString
        await sendToThread(
          monitoringState.threadId,
          `構造化出力が更新されました:\n\`\`\`json\n${truncatedOutput}\n\`\`\``
        )
      } else {
        console.log(`[Muted] Suppressed structured output notification for thread ${monitoringState.threadId}`)
      }
      monitoringState.lastStructuredOutput = newOutput
    }

    // 3. 終了状態か確認 (通知はミュート時スキップ、監視停止は行う)
    if (newStatus && TERMINAL_SESSION_STATES.includes(newStatus)) {
      console.log(`Session ${sessionId} reached terminal state: ${newStatus}. Logging full response and stopping monitoring.`)
      console.log('Full API Response:', JSON.stringify(currentDetails, null, 2))
      if (!isMuted) {
        await sendToThread(
          monitoringState.threadId,
          `セッションは状態「**${newStatus}**」で終了しました。監視を停止します。`
        )
      } else {
        console.log(`[Muted] Suppressed session termination notification for thread ${monitoringState.threadId}`)
      }
      stopSessionMonitoring(sessionId) // 監視停止は行う
    }

  } catch (error) {
    console.error(`Error polling session ${sessionId}:`, error)
    if (!isMuted) { // ミュート中でなければエラー通知
      await sendToThread(
        monitoringState.threadId,
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

      threadSessionMap.set(thread.id, sessionResponse.session_id)
      console.log(`Stored session mapping: ${thread.id} -> ${sessionResponse.session_id}`)

      await thread.send(
        `Devin セッションを開始しました。
セッション ID: ${sessionResponse.session_id}
進捗はこちらで確認できます: ${sessionResponse.url}

このスレッド内で Devin への指示を送信してください。
(メッセージの先頭に \`${ASIDE_KEYWORD}\` と付けると Devin には送られません)`
      )
      console.log(`Sent initial message to thread ${thread.id}`)

      await startSessionMonitoring(sessionResponse.session_id, thread.id)

    } catch (error) {
      console.error('Error processing mention:', error)
      const errorMessage = error instanceof Error ? error.message : '不明なエラーが発生しました。'
      try {
        const replyContent = `Devin セッションの開始またはスレッドの作成に失敗しました。
エラー: ${errorMessage}`
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
    const sessionId = threadSessionMap.get(threadId)

    // ★★ キーワード処理を追加 ★★
    const lowerContent = message.content.trim().toLowerCase()

    // Mute コマンド
    if (lowerContent === MUTE_KEYWORD) {
      if (!mutedThreads.has(threadId)) {
        mutedThreads.add(threadId)
        console.log(`Thread ${threadId} muted.`)
        await message.reply('🔇 このスレッドでの Devin からの通知をミュートしました。')
      } else {
        await message.reply('🔇 このスレッドは既にミュートされています。')
      }
      return // mute コマンド自体は Devin に送らない
    }

    // Unmute コマンド
    if (lowerContent === UNMUTE_KEYWORD) {
      if (mutedThreads.has(threadId)) {
        mutedThreads.delete(threadId)
        console.log(`Thread ${threadId} unmuted.`)
        await message.reply('🔊 このスレッドのミュートを解除しました。')
      } else {
        await message.reply('🔊 このスレッドはミュートされていません。')
      }
      return // unmute コマンド自体は Devin に送らない
    }

    // Aside キーワード
    if (lowerContent.startsWith(ASIDE_KEYWORD)) {
      console.log(`Aside message detected in thread ${threadId}. Ignoring.`)
      // await message.react('🤫')
      return // aside メッセージは Devin に送らない
    }

    // セッション ID が不明な場合
    if (!sessionId) {
      console.warn(`Session ID not found for thread ${threadId}. Ignoring message.`)
      return
    }

    // ★★ ミュート中のメッセージ転送スキップ ★★
    if (mutedThreads.has(threadId)) {
      console.log(`[Muted] Suppressing message send from thread ${threadId} to session ${sessionId}`)
      // 必要であればユーザーにミュート中であることを伝えるリアクションなど
      // await message.react('🔇')
      return
    }

    try {
      console.log(`Sending message from thread ${threadId} to session ${sessionId}: "${message.content}"`)
      await sendMessage(sessionId, { message: message.content })
      // 成功したらリアクションなどでフィードバック (任意)
      // await message.react('✅')
    } catch (error) {
      console.error(`Error sending message to Devin session ${sessionId}:`, error)
      const errorMessage = error instanceof Error ? error.message : '不明なエラーが発生しました。'
      try {
        await message.reply(`Devin へのメッセージ送信に失敗しました。
エラー: ${errorMessage}`)
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
