# YouTube入力対応タスク

## 背景

現状のアプリはローカルの MP4 を選択し、同じソースを `<video>` と `<audio>` に読み込んで、
音声オフセット、再生速度変更、トリム、FFmpeg エクスポートを行う構成になっている。

現在の主な前提:

- 入力はローカルファイルのみ
- 実メディアをブラウザから直接読めることが前提
- クライアント中心の実装で、ローカル MP4 を object URL として再生している
- エクスポートはローカルファイルを FFmpeg に渡している

## 目的

動画の入力方法を増やし、以下の 3 通りをユーザーに提供したい。

1. ローカルファイルから読み込む
2. YouTube URL を貼って動画を指定する
3. YouTube を検索して動画を探して指定する

## 重要な制約

このタスクで最初に固定すべき点は、`YouTube 動画をこのアプリでどう扱うか` である。

現在のアプリは `video と audio を分けて同じソースを再生する` ことでオフセット機能を実現している。
YouTube の通常の埋め込み再生や URL だけでは、同じようにブラウザから直接メディアを二重に制御できない。

そのため、以下を前提に進める。

- `ローカル MP4` は現在のフル機能を維持する
- `YouTube URL` と `YouTube 検索` はまず `動画選択・発見フロー` として追加する
- `YouTube 動画を現行のオフセット/エクスポート機能にそのまま流し込む` のは初回スコープから外す

理由:

- YouTube の埋め込み再生は HTMLMediaElement の MP4 直読みとは別物
- 生の動画/音声データをクライアントから自由に扱える前提ではない
- ダウンロードや変換を含む設計は技術面だけでなく利用規約面の検討が必要

## 推奨スコープ

### Phase 1: 入力モード切り替え UI を追加

- `ローカルファイル`
- `YouTube URL`
- `YouTube 検索`

をタブまたはセグメントコントロールで切り替えられるようにする。

### Phase 2: YouTube URL 対応

- YouTube URL を入力できるフォームを追加
- URL から `videoId` を抽出
- サムネイル、タイトル、チャンネル名などを表示
- `YouTube で開く` を提供
- 必要なら埋め込みプレビューを表示

この段階では以下を明示する:

- オフセット調整
- トリム
- FFmpeg エクスポート

はローカルファイル専用

### Phase 3: YouTube 検索対応

- YouTube Data API を使うサーバー側 API ルートを追加
- キーワード検索フォームを追加
- 検索結果一覧を表示
- 1 件選択すると URL モードと同じ詳細表示へ遷移

## 非スコープ

今回やらないもの:

- YouTube 動画のダウンロード
- YouTube 動画をローカル MP4 のように `<video>` と `<audio>` に分離して扱う処理
- YouTube ソースに対する FFmpeg エクスポート
- YouTube ログイン連携
- 再生履歴やお気に入り保存

## 推奨プロダクト仕様

### ローカルファイル

- 現状機能を維持
- オフセット調整可
- トリム可
- エクスポート可

### YouTube URL

- URL 入力欄を表示
- URL が不正ならエラーメッセージを出す
- URL が正しければ動画メタデータを表示する
- `YouTube で開く` ボタンを出す
- 必要なら埋め込みプレビューを表示する
- `この入力方式ではオフセット/エクスポートは使えません` を明示する

### YouTube 検索

- 検索語を入力
- 検索結果にサムネイル、タイトル、チャンネル名を表示
- 1 件選ぶと URL モードと同等の表示に遷移
- `YouTube で開く` を提供

## UI 要件

- 既存の「ファイルを選択」の上か横に入力モード切替を追加
- モードが変わったら、そのモードに関係ない入力状態はクリアする
- 現在の再生ソース種別がわかる表示を入れる
- YouTube 系モードでは、ローカル専用操作を disable するか非表示にする
- エラーメッセージは入力欄の近くに出す

## 技術方針

### 1. ソースの型を明示する

例:

```ts
type SourceMode = "local" | "youtube-url" | "youtube-search";
```

例:

```ts
type LoadedSource =
  | { kind: "local"; file: File; objectUrl: string }
  | { kind: "youtube"; videoId: string; url: string; title?: string };
```

### 2. ローカル専用機能のガードを入れる

以下は `kind === "local"` の時だけ有効にする:

- `sourceFile` 前提の処理
- FFmpeg エクスポート
- トリム UI
- 音声オフセットの同期ループ

### 3. YouTube 検索は API キーをクライアントに直接出さない

推奨:

- `app/api/youtube/search/route.ts`
- サーバー側で YouTube Data API を呼ぶ
- クライアントは自前 API を叩く

想定環境変数:

```bash
YOUTUBE_API_KEY=...
```

### 4. URL 解析ロジックを分離する

候補:

- `app/lib/youtube.ts`

役割:

- URL から `videoId` を抽出
- 検索結果レスポンスを画面用に整形
- サムネイル URL を返す

## 想定変更ファイル

- `app/player.tsx`
- `app/page.tsx`
- `app/lib/youtube.ts`
- `app/api/youtube/search/route.ts`
- `README.md`
- `.env.example` または同等の設定ドキュメント

## 実装手順

1. 既存差分を整理する
2. 入力モード state を追加する
3. ローカル入力 UI を新しいモード構成に移す
4. YouTube URL 入力 UI と URL 解析処理を追加する
5. YouTube メタデータ表示 UI を追加する
6. ローカル専用機能の disable 条件を整理する
7. YouTube 検索 API ルートを追加する
8. YouTube 検索 UI を追加する
9. README と環境変数説明を追加する
10. build / lint / 手動確認を行う

## 受け入れ条件

- ローカルファイルは今まで通り再生できる
- ローカルファイルで音声オフセットが使える
- ローカルファイルでエクスポートが使える
- YouTube URL を貼ると動画として認識できる
- 不正な YouTube URL はエラー表示される
- YouTube 検索で結果一覧が出る
- 検索結果から 1 件選べる
- YouTube モードではローカル専用機能が誤って動かない
- API キーがクライアントバンドルに露出しない

## 手動確認項目

- ローカル MP4 を選び、再生/シーク/オフセット/エクスポートが壊れていない
- YouTube URL を貼り、正しい動画 ID が取れる
- `youtu.be/...` と `youtube.com/watch?v=...` の両方で動く
- 検索結果から動画を選ぶと詳細表示に移る
- YouTube モードで export ボタンが disable される
- 入力モード切替時に前の state が悪影響を出さない

## Git 方針

### 先にやること

現在 `master` に未コミット差分があるため、先に整理する。

- 黒帯除去解除の変更は独立コミットにする
- `package.json` / `package-lock.json` の Next 更新が意図していないなら戻す

### 推奨ブランチ

```bash
git switch -c feature/source-mode-youtube
```

規模を抑えたいならさらに分割する:

```bash
git switch -c feature/youtube-url-input
git switch -c feature/youtube-search
```

### 推奨コミット単位

- `refactor: introduce source mode abstraction`
- `feat: add youtube url source input`
- `feat: add youtube search via server route`
- `docs: document youtube api setup`

## リスク

- YouTube の扱いを `選択 UI` ではなく `実メディア取り込み` と誤解すると実装が破綻しやすい
- 検索機能は API キー管理が必要
- 検索回数や quota 制限を考慮する必要がある
- 既存 player はローカル MP4 前提で書かれているため、分岐を雑に入れるとバグになりやすい

## 実装前に確認すべきこと

1. YouTube は `このアプリ内で埋め込み再生まで` でよいか
2. それとも `YouTube 動画を現行オフセット機能に直接載せたい` のか
3. YouTube 検索結果はアプリ内に出せばよいか、別タブで YouTube 検索を開くだけでよいか

## 現時点の推奨判断

最初の PR では以下に限定するのが安全:

- 入力モード切替
- YouTube URL の解析
- YouTube 検索結果表示
- YouTube への遷移または埋め込みプレビュー
- ローカル専用機能のガード

`YouTube をローカル MP4 と同等に扱う` ことは、別タスクとして切り出す。
