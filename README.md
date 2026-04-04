# Video + Audio Offset Player

ローカル MP4 や YouTube 動画を取り込み、音声オフセット調整、再生速度変更、トリム、FFmpeg ベースの書き出しを行う Next.js アプリです。

## 機能

### ローカルファイル

- MP4 を直接読み込み
- 音声オフセット調整
- 再生速度変更
- トリム範囲設定
- FFmpeg 書き出し

### YouTube

- YouTube URL の解決
- YouTube 検索
- 埋め込みプレビュー
- `yt-dlp` を使った MP4 取り込み

取り込んだ後はローカル MP4 と同じフローに入り、オフセット調整や書き出しが使えます。

## セットアップ

```bash
npm install
```

`.env.example` を参考に `.env.local` を作成します。

```bash
youtube_api_key=your_youtube_data_api_key_here
youtube_api_referer=http://localhost:3000/
YT_DLP_PATH=yt-dlp
FFMPEG_PATH=ffmpeg
YT_DLP_MAX_FILESIZE_MB=250
YT_DLP_COOKIES_FROM_BROWSER=chrome
```

`youtube_api_key` を優先して読み込みます。後方互換のため `YOUTUBE_API_KEY` も利用できます。
HTTP リファラー制限付きのキーを使う場合は `youtube_api_referer` を設定すると、サーバーからの YouTube API 呼び出しでも `Referer` を付与できます。

### 必要な外部ツール

- `yt-dlp`
- `ffmpeg`

どちらも PATH に通すか、`.env.local` で実行ファイルパスを指定してください。

例:

```bash
YT_DLP_PATH=C:\tools\yt-dlp.exe
FFMPEG_PATH=C:\tools\ffmpeg.exe
```

YouTube 側で bot 確認が出る場合は、`yt-dlp` に browser cookies を渡してください。

```bash
YT_DLP_COOKIES_FROM_BROWSER=chrome
```

Chrome ではなく Edge を使う場合は `edge` に変えてください。cookies.txt を使う場合は `YT_DLP_COOKIES_PATH` も使えます。

## 開発

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。

## 検証

```bash
npm run lint
npm run build
```

`public/ffmpeg/**` は配布済みバンドルのため、ESLint 対象から除外しています。

## 注意

- YouTube 取り込みはサーバー側で `yt-dlp` を実行します
- 長い動画や大きい動画は `YT_DLP_MAX_FILESIZE_MB` によって失敗することがあります
- 利用権限のある動画のみ扱ってください
