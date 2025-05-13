# generate-aws-weekly-update-report

AWS の週次アップデート情報を収集し、Slack に通知する CDK プロジェクトです。

## プロジェクト概要

このプロジェクトは、AWS (Amazon Web Services) の週次アップデート情報を自動的に収集し、指定された Slack チャンネルに通知する AWS Cloud Development Kit (CDK) プロジェクトです。
AWS の最新情報をチームに共有することで、常に最新の情報を把握し、迅速な意思決定を支援します。
特に、AWS を利用する開発チームや DevOps チームにとって、最新情報のキャッチアップにかかる時間を削減し、効率的な情報共有を実現します。

## 必要な環境

- AWS CLI: AWS リソースを操作するために必要です。
  - インストール方法: [AWS CLI のインストール](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) を参照してください。
  - バージョン: AWS CLI バージョン 2 を推奨します。
- CDK Toolkit: AWS CDK アプリケーンロード](https://nodejs.org/en/download/) からインストールします。
  - バージョン: Node.js バージョン 16 以上を推奨します。
- npm: Node.js のパッケージマネージャーです。Node.js をインストールすると自動的にインストールされます。
  - バージョン: npm バージョン 8 ションをデプロイするために必要です。
  - インストール方法: `npm install -g aws-cdk` でインストールします。
  - バージョン: AWS CDK バージョン 2 を推奨します。
- Node.js: CDK アプリケーションの実行環境として必要です。
  - インストール方法: [Node.js のダウ以上を推奨します。

## インストール方法

```bash
npm install
```

このコマンドは、package.json に記載された依存関係をインストールします。

## デプロイ方法

```bash
npx cdk deploy
```

このコマンドは、CDK アプリケーションを AWS 環境にデプロイします。
デプロイ前に、AWS CLI で適切な認証設定を行ってください。
また、CDK Toolkit が AWS 環境にアクセスするための IAM ロールが必要です。

デプロイ時にエラーが発生する場合は、以下の点を確認してください。

- AWS CLI の認証設定が正しいか。
- CDK Toolkit が AWS 環境にアクセスするための IAM ロールが設定されているか。
- 必要な AWS リソース (VPC、サブネットなど) が存在するか。

## 設定方法

以下の環境変数を設定する必要があります。

- `SLACK_WEBHOOK_URL`: Slack の Webhook URL を設定します。
  - 設定例: `https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX`
  - Slack の Webhook URL は、Slack ワークスペースの設定画面から取得できます。
- `AWS_REGION`: AWS リージョンを設定します。
  - 設定例: `ap-northeast-1` (東京リージョン)
  - AWS リージョンは、AWS リソースをデプロイするリージョンを指定します。

環境変数の設定は、ターミナルから行うか、`.env` ファイルに記述して行うことができます。

## スクリプトの実行方法

```bash
npm run build
```

このコマンドは、TypeScript コードを JavaScript コードにコンパイルします。

```bash
npm run deploy
```

このコマンドは、CDK アプリケーションを AWS 環境にデプロイします。
`npx cdk deploy` と同じです。

## アーキテクチャ図

```mermaid
graph LR
    A[AWS RSSフィード] --> B(Lambda関数);
    B --> C{S3};
    C --> D(Lambda関数);
    D --> E{Slack};
    style A fill:#f9f,stroke:#333,stroke-width:2px
    style B fill:#ccf,stroke:#333,stroke-width:2px
    style C fill:#fcc,stroke:#333,stroke-width:2px
    style D fill:#ccf,stroke:#333,stroke-width:2px
    style E fill:#fcc,stroke:#333,stroke-width:2px
```

このアーキテクチャ図は、AWS の週次アップデート情報を収集し、Slack に通知するシステムの概要を示しています。

- AWS RSSフィード: AWS の最新情報が掲載された RSS フィードです。
- Lambda関数: RSS フィードから情報を収集し、S3に格納する AWS Lambda 関数です。
- S3: 収集された情報を格納する AWS Simple Storage Service (S3) バケットです。
- Lambda関数: S3に格納された情報をSlackに通知する AWS Lambda 関数です。
- Slack: 収集された情報が通知される Slack チャンネルです。

1つ目のLambda関数は、定期的に AWS RSS フィードをポーリングし、新しい情報があれば S3 バケットに格納します。
2つ目のLambda関数は、S3 バケットに新しい情報が格納されると、Slack に通知します。

## 貢献方法

CONTRIBUTING.md を参照してください。
このプロジェクトに貢献するには、GitHub リポジトリに Pull Request を送信してください。
Pull Request を送信する前に、以下の点を確認してください。

- コードが Clean Code の原則に従っているか。
- テストが正常に実行されるか。
- コードのスタイルがプロジェクトのスタイルガイドに従っているか。

## ライセンス

MIT License
LICENSE を参照してください。
このプロジェクトは、MIT License の下で公開されています。
MIT License は、商用利用、改変、配布を許可するライセンスです。

## その他

CONTRIBUTING.md、LICENSE なども参照してください。
