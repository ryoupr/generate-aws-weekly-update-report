#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsWeeklyReportCdkStack } from '../lib/aws-weekly-report-cdk-stack';

const app = new cdk.App();

// 環境変数からSlack Webhook URLを取得
const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

// スタックに渡すプロパティを定義
// 必要に応じて環境変数やCDKコンテキストから取得するように変更できるぞ
const stackProps = {
  // env: {
  //   account: process.env.CDK_DEFAULT_ACCOUNT, // デプロイ対象のアカウント
  //   region: process.env.CDK_DEFAULT_REGION,   // デプロイ対象のリージョン
  // },
  reportOutputS3BucketBaseName: 'generated-aws-weekly-reports', // ここは実際に使用するベース名に変更するのじゃ
  lambdaFunctionName: 'GeneratedAwsWeeklyReport', // オプション: Lambda関数名を変更する場合
  // reportOutputS3KeyPrefix: 'custom-reports/', // オプション: S3キープレフィックスを変更する場合
  // rssFeedUrl: 'YOUR_CUSTOM_RSS_FEED_URL', // オプション: RSSフィードURLを変更する場合
  scheduleExpression: 'cron(0 1 ? * TUE *)', // オプション: 実行スケジュールを変更する場合 (例: 毎週月曜1時UTC)
  // lambdaTimeoutSeconds: 120, // オプション: Lambdaのタイムアウトを変更する場合
  // lambdaMemoryMB: 512, // オプション: Lambdaのメモリを変更する場合
  slackWebhookUrl: slackWebhookUrl,
};

new AwsWeeklyReportCdkStack(app, 'GeneratedAwsWeeklyReport', stackProps);

app.synth();
