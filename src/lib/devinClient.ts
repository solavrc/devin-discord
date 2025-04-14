import axios, { AxiosInstance, AxiosError } from 'axios'
import * as fs from 'fs' // ファイルアップロードで使用
import FormData from 'form-data' // ファイルアップロードで使用
import { inspect } from 'util' // ログ出力用にインポート

// --- 定義 ---

// セッション作成リクエストボディ
interface CreateSessionPayload {
  prompt: string
  snapshot_id?: string | null
  playbook_id?: string | null
  unlisted?: boolean | null
  idempotent?: boolean | null
  max_acu_limit?: number | null
  planning_mode_agency?: 'auto_confirm' | 'sync_confirm' | null
  secret_ids?: string[] | null
  knowledge_ids?: string[] | null
  tags?: string[] | null
  title?: string | null
}

// セッション作成レスポンス
interface CreateSessionResponse {
  session_id: string
  url: string
  is_new_session?: boolean
}

// メッセージ送信リクエストボディ
interface SendMessagePayload {
  message: string
}

// セッション詳細レスポンス
export interface SessionDetailsResponse {
  session_id: string
  status: string
  title: string | null
  created_at: string
  updated_at: string
  snapshot_id: string | null
  playbook_id: string | null
  tags: string[] | null
  pull_request: { url: string } | null
  structured_output: any | null // Devinドキュメントに基づきany型
  status_enum: string | null // ドキュメントに記載されている値 + α を考慮
}

// セッション一覧取得レスポンス
interface SessionSummary {
  session_id: string
  status: string
  title: string
  created_at: string
  updated_at: string
  snapshot_id: string | null
  playbook_id: string | null
  tags: string[] | null
  pull_request: { url: string } | null
  structured_output: any | null
  status_enum: string | null
}

interface ListSessionsResponse {
  sessions: SessionSummary[]
}

// セッションタグ更新リクエストボディ
interface UpdateSessionTagsPayload {
  tags: string[]
}

// シークレットメタデータ
interface SecretMetadata {
  secret_id: string
  secret_type: 'cookie' | 'key-value' | 'dictionary' | 'totp'
  secret_name: string
  created_at: string
}

// シークレットメタデータ一覧取得レスポンス
interface ListSecretsResponse {
  secrets: SecretMetadata[]
}

// 監査ログエントリ
interface AuditLogEntry {
  created_at: number // Unix timestamp in milliseconds
  action: string // ドキュメント記載の Enum 値
  ip?: string
  user_id?: string
  session_id?: string
  target_user_id?: string
  roles?: string[]
  // 他のアクション固有フィールド...
}

// 監査ログ一覧取得レスポンス
interface ListAuditLogsResponse {
  audit_logs: AuditLogEntry[]
}

// エンタープライズ消費データレスポンス (ドキュメントに詳細なし)
interface EnterpriseConsumptionResponse {
  // 型は不明
  [key: string]: any
}

// --- API クライアント初期化 ---

const DEVIN_API_KEY = process.env.DEVIN_API_KEY
const API_BASE = 'https://api.devin.ai/v1'

if (!DEVIN_API_KEY) {
  console.error('環境変数 DEVIN_API_KEY が設定されていません。')
  // 必要に応じてプロセスを終了するなどの処理を追加
  process.exit(1) // 例: エラーで終了
}

const devinApiClient: AxiosInstance = axios.create({
  baseURL: API_BASE,
  headers: {
    'Authorization': `Bearer ${DEVIN_API_KEY}`,
    'Content-Type': 'application/json'
  }
})

// --- Axios インターセプターによるロギング ---

// リクエストインターセプター
devinApiClient.interceptors.request.use(
  (config) => {
    const { method, url, data } = config
    console.log(`[API Request] ${method?.toUpperCase()} ${url}`)
    if (data && Object.keys(data).length > 0) {
      // data が FormData の場合は inspect で中身が見えないことがある
      // JSON の場合は stringify するなど、必要に応じて調整
      console.log(`  Payload: ${inspect(data, { depth: null, colors: false })}`)
    }
    return config
  },
  (error) => {
    console.error('[API Request Error]', error)
    return Promise.reject(error)
  }
)

// レスポンスインターセプター
devinApiClient.interceptors.response.use(
  (response) => {
    const { status, statusText, config, data } = response
    console.log(`[API Response] ${status} ${statusText} (${config.method?.toUpperCase()} ${config.url})`)
    if (data) {
      console.log(`  Data: ${inspect(data, { depth: null, colors: false })}`)
    }
    return response
  },
  (error: AxiosError) => {
    // AxiosError 型を指定して、レスポンス情報にアクセスしやすくする
    const { config, response, message } = error
    if (response) {
      // API からエラーレスポンスが返ってきた場合
      const { status, statusText, data } = response
      console.error(`[API Response Error] ${status} ${statusText} (${config?.method?.toUpperCase()} ${config?.url})`)
      if (data) {
        console.error(`  Error Data: ${inspect(data, { depth: null, colors: false })}`)
      }
    } else if (error.request) {
      // リクエストは送信されたが、レスポンスがなかった場合
      console.error(`[API Request Error] No response received for ${config?.method?.toUpperCase()} ${config?.url}:`, message)
    } else {
      // リクエスト設定時のエラーなど
      console.error('[API Setup Error]', message)
    }
    // エラーを reject して、呼び出し元の catch ブロックで処理できるようにする
    return Promise.reject(error)
  }
)

// --- API 呼び出し関数 ---

/**
 * 新しい Devin セッションを作成します。
 * @param payload セッション作成のためのペイロード
 * @returns セッション作成結果
 */
export async function createSession(payload: CreateSessionPayload): Promise<CreateSessionResponse> {
  try {
    const response = await devinApiClient.post<CreateSessionResponse>('/sessions', payload)
    return response.data
  } catch (error) {
    console.error('Error creating Devin session:', error)
    throw error // エラーを再スローして呼び出し元で処理できるようにする
  }
}

/**
 * 既存の Devin セッションにメッセージを送信します。
 * @param sessionId メッセージを送信するセッションの ID
 * @param payload 送信するメッセージを含むペイロード
 */
export async function sendMessage(sessionId: string, payload: SendMessagePayload): Promise<void> {
  try {
    // 204 No Content または 200 OK を成功とみなす
    await devinApiClient.post(`/session/${sessionId}/message`, payload, {
      validateStatus: (status) => status === 204 || status === 200 // 200 も許容するように変更
    })
  } catch (error) {
    console.error(`Error sending message to session ${sessionId}:`, error)
    throw error
  }
}

/**
 * 指定された Devin セッションの詳細を取得します。
 * @param sessionId 詳細を取得するセッションの ID
 * @returns セッション詳細情報
 */
export async function getSessionDetails(sessionId: string): Promise<SessionDetailsResponse> {
  try {
    const response = await devinApiClient.get<SessionDetailsResponse>(`/session/${sessionId}`)
    return response.data
  } catch (error) {
    console.error(`Error getting details for session ${sessionId}:`, error)
    throw error
  }
}

/**
 * 組織の Devin セッションをリスト表示します。
 * @param limit 取得する最大セッション数 (1-1000)
 * @param offset ページネーションオフセット
 * @param tags フィルタリングするタグの配列
 * @returns セッションのリスト
 */
export async function listSessions(
  limit: number = 100,
  offset: number = 0,
  tags?: string[]
): Promise<ListSessionsResponse> {
  try {
    const params: Record<string, any> = { limit, offset }
    if (tags && tags.length > 0) {
      // クエリパラメータの配列は key=value1&key=value2 形式で渡す必要がある場合がある
      // axios はデフォルトで key[]=value1&key[]=value2 形式にするため、
      // 必要に応じて paramsSerializer をカスタマイズする必要があるかもしれないが、
      // Devin API のドキュメントには具体的な形式が記載されていないため、一旦デフォルトで試す
      params.tags = tags
    }
    const response = await devinApiClient.get<ListSessionsResponse>('/sessions', { params })
    return response.data
  } catch (error) {
    console.error('Error listing Devin sessions:', error)
    throw error
  }
}

/**
 * Devin が使用するファイルをアップロードします。
 * @param filePath アップロードするファイルのパス
 * @returns アップロードされたファイルの URL
 */
export async function uploadAttachment(filePath: string): Promise<string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }
  const form = new FormData()
  form.append('file', fs.createReadStream(filePath))
  const url = `${API_BASE}/attachments` // インターセプターが効かないのでフルパス

  console.log(`[API Request] POST ${url} (FormData)`) // 手動ログ
  console.log(`  Payload: File from ${filePath}`)     // 手動ログ

  try {
    const response = await axios.post<string>(
      url,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${DEVIN_API_KEY}`
        }
      }
    )
    console.log(`[API Response] ${response.status} ${response.statusText} (POST ${url})`) // 手動ログ
    console.log(`  Data: ${response.data}`) // 手動ログ (URL文字列)
    return response.data
  } catch (error) {
    const axiosError = error as AxiosError // 型アサーション
    if (axiosError.response) {
      console.error(`[API Response Error] ${axiosError.response.status} ${axiosError.response.statusText} (POST ${url})`)
      console.error(`  Error Data: ${inspect(axiosError.response.data, { depth: null, colors: false })}`)
    } else {
      console.error(`[API Request/Response Error] Error uploading attachment ${filePath}:`, axiosError.message)
    }
    throw error // エラーを再スロー
  }
}

/**
 * Devin セッションのタグを更新します。
 * @param sessionId タグを更新するセッションの ID
 * @param payload 設定するタグを含むペイロード
 */
export async function updateSessionTags(sessionId: string, payload: UpdateSessionTagsPayload): Promise<{ detail: string }> {
  try {
    const response = await devinApiClient.put<{ detail: string }>(`/session/${sessionId}/tags`, payload)
    return response.data
  } catch (error) {
    console.error(`Error updating tags for session ${sessionId}:`, error)
    throw error
  }
}

/**
 * 組織内のすべてのシークレットのメタデータをリスト表示します。
 * @returns シークレットメタデータのリスト
 */
export async function listSecrets(): Promise<ListSecretsResponse> {
  try {
    const response = await devinApiClient.get<ListSecretsResponse>('/secrets')
    return response.data
  } catch (error) {
    console.error('Error listing secrets:', error)
    throw error
  }
}

/**
 * 指定した ID のシークレットを削除します。
 * @param secretId 削除するシークレットの ID
 */
export async function deleteSecret(secretId: string): Promise<void> {
  try {
    await devinApiClient.delete(`/secrets/${secretId}`, {
      validateStatus: (status) => status === 204
    })
  } catch (error) {
    console.error(`Error deleting secret ${secretId}:`, error)
    throw error
  }
}

/**
 * 組織の監査ログをリスト表示します。
 * @param limit 取得する最大ログ数
 * @param before このタイムスタンプより前のログを取得 (ISO 8601)
 * @param after このタイムスタンプより後のログを取得 (ISO 8601)
 * @returns 監査ログのリスト
 */
export async function listAuditLogs(
  limit: number = 100,
  before?: string,
  after?: string
): Promise<ListAuditLogsResponse> {
  try {
    const params: Record<string, any> = { limit }
    if (before) params.before = before
    if (after) params.after = after

    const response = await devinApiClient.get<ListAuditLogsResponse>('/audit-logs', { params })
    return response.data
  } catch (error) {
    console.error('Error listing audit logs:', error)
    throw error
  }
}

/**
 * エンタープライズ組織の指定期間における消費データを取得します。
 * @param startDate 開始日 (YYYY-MM-DD)
 * @param endDate 終了日 (YYYY-MM-DD)
 * @returns 消費データ (型はドキュメント未定義)
 */
export async function getEnterpriseConsumption(
  startDate: string,
  endDate: string
): Promise<EnterpriseConsumptionResponse> {
  try {
    const params = { start_date: startDate, end_date: endDate }
    const response = await devinApiClient.get<EnterpriseConsumptionResponse>('/enterprise/consumption', { params })
    return response.data
  } catch (error) {
    console.error('Error getting enterprise consumption:', error)
    throw error
  }
}

// export default devinApiClient // 個別の関数をエクスポートするため、デフォルトエクスポートは不要になる場合がある
