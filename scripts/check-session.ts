import dotenv from 'dotenv'
import { getSessionDetails } from '../src/lib/devinClient' // パスを調整

// .env ファイルから環境変数を読み込む
dotenv.config()

async function checkSessionStatus() {
  // コマンドライン引数からセッション ID を取得
  const sessionId = process.argv[2] // ts-node scripts/check-session.ts <session_id>

  if (!sessionId) {
    console.error('Error: Session ID must be provided as a command-line argument.')
    console.log('Usage: npm run check-session <session_id>')
    process.exit(1)
  }

  // Devin API キーが設定されているか確認 (devinClient 内でもチェックされるが一応)
  if (!process.env.DEVIN_API_KEY) {
    console.error('Error: DEVIN_API_KEY environment variable is not set.')
    process.exit(1)
  }

  console.log(`Checking status for session: ${sessionId}...`)

  try {
    const details = await getSessionDetails(sessionId)
    console.log('Session Details:')
    console.log(JSON.stringify(details, null, 2)) // 取得した詳細を JSON で表示
  } catch (error) {
    console.error(`Failed to get details for session ${sessionId}.`)
    // エラーオブジェクトの詳細も表示 (axios インターセプターでログ出力されるはずだが念のため)
    if (error instanceof Error) {
      console.error('Error details:', error.message)
      // もし axios のエラーなら詳細を表示
      if ('response' in error && error.response) {
        console.error('API Response Error:', JSON.stringify((error as any).response.data, null, 2))
      }
    } else {
      console.error('An unknown error occurred:', error)
    }
    process.exit(1) // エラーで終了
  }
}

checkSessionStatus()
