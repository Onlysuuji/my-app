# Video + Audio Offset Player

ローカル MP4 と YouTube 動画を読み込み、音声オフセット、再生速度、トリム、書き出しを行う Next.js アプリです。

## 機能

### ローカルファイル

- MP4 の読み込み
- 音声オフセット調整
- 再生速度変更
- トリム範囲設定
- FFmpeg を使った書き出し

### YouTube

- YouTube URL の読み込み
- YouTube 検索
- クリックで取り込み
- `yt-dlp` を使った MP4 取得

YouTube から取り込んだ動画は、そのままローカルファイル入力として扱われるので、ローカル MP4 と同じ編集機能が使えます。

## セットアップ

```bash
npm install
```

`.env.example` を参考に `.env.local` を作成してください。

```bash
youtube_api_key=your_youtube_data_api_key_here
youtube_api_referer=http://localhost:3000/
YT_DLP_PATH=yt-dlp
FFMPEG_PATH=ffmpeg
YT_DLP_MAX_FILESIZE_MB=250
YT_DLP_TIMEOUT_MS=300000
YOUTUBE_IMPORT_MAX_CONCURRENT=2
```

`youtube_api_key` を設定すると YouTube 検索が使えます。既存設定との互換のため `YOUTUBE_API_KEY` も読みますが、新規設定は `youtube_api_key` を使ってください。

`youtube_api_referer` を設定すると、サーバー側から YouTube Data API を呼ぶときにも `Referer` を付けます。Google Cloud Console 側の許可リファラーと一致させてください。

### 必要なツール

- `yt-dlp`
- `ffmpeg`

どちらも PATH に通すか、`.env.local` で実行ファイルパスを指定してください。

```bash
YT_DLP_PATH=C:\tools\yt-dlp.exe
FFMPEG_PATH=C:\tools\ffmpeg.exe
```

### cookies

ローカル開発中だけ browser cookies 自動読み込みを使えます。

```bash
YT_DLP_COOKIES_FROM_BROWSER=edge
```

公開環境では `YT_DLP_COOKIES_FROM_BROWSER` は使わず、必要なら `cookies.txt` を指定してください。

```bash
YT_DLP_COOKIES_PATH=/run/secrets/youtube-cookies.txt
```

## 公開前提の防御

- `/api/youtube/search` に検索レート制限
- `/api/youtube/resolve` に同一オリジン検証と取り込みレート制限
- `videoId` から正規の watch URL を再構築して `yt-dlp` に渡す
- 公開環境では `YT_DLP_COOKIES_FROM_BROWSER` を禁止
- `yt-dlp` 実行にタイムアウトを設定
- 取り込み同時実行数を制限
- ダウンロード後に実ファイルサイズを再検証
- 取り込み結果はサーバーで検証後に返す
- production では任意でサイト全体に Basic 認証を掛けられる

関連する主な環境変数は次です。

- `YT_DLP_MAX_FILESIZE_MB`: 取り込む動画の最大サイズ
- `YT_DLP_TIMEOUT_MS`: 1 回の `yt-dlp` 実行タイムアウト
- `YOUTUBE_IMPORT_MAX_CONCURRENT`: 同時に走らせる import の上限
- `APP_BASIC_AUTH_USER` / `APP_BASIC_AUTH_PASSWORD`: production 用の Basic 認証

## 開発

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いてください。

## 検証

```bash
npm run lint
npm run build
```

## Docker 公開

`.env.production.example` をコピーして `.env.production` を作り、本番値を設定します。

```bash
docker compose build
docker compose up -d
```

構成は次の 2 コンテナです。

- `app`: Next.js + `ffmpeg` + `yt-dlp`
- `proxy`: nginx。`/api/youtube/search` と `/api/youtube/resolve` に追加レート制限を適用

### 本番用 cookies

公開環境では `cookies.txt` を `./secrets/youtube-cookies.txt` に置き、`.env.production` に以下を設定してください。

```bash
YT_DLP_COOKIES_PATH=/run/secrets/youtube-cookies.txt
```

### Basic 認証

production でサイト全体を Basic 認証で保護したい場合は、`.env.production` に次を設定してください。

```bash
APP_BASIC_AUTH_USER=admin
APP_BASIC_AUTH_PASSWORD=replace_with_a_long_random_password
```

設定すると、画面と API の両方が認証対象になります。必ず HTTPS の前段プロキシ経由で公開してください。

### 本番時の注意

- HTTPS の前段プロキシで公開する
- `youtube_api_referer` は公開 URL に合わせる
- 単一インスタンス前提のメモリ制限なので、多段構成では外側でも rate limit を掛ける
- 取り込み動画は一時的に `/tmp/youtube-imports` を使うため、十分なディスク容量が必要
