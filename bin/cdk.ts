#!/usr/bin/env node
import 'source-map-support/register'; // source-map-support を追加 (デバッグ時に役立つ)
import * as cdk from 'aws-cdk-lib';
import { AwsWeeklyReportCdkStack } from '../lib/aws-weekly-report-cdk-stack'; // 正しいスタックをインポート

const app = new cdk.App();

// スタックに渡すプロパティを定義
const stackProps = {
  // env: { // 必要に応じてアカウント/リージョンを指定
  //   account: process.env.CDK_DEFAULT_ACCOUNT,
  //   region: process.env.CDK_DEFAULT_REGION,
  // },
  reportOutputS3BucketBaseName: 'generated-aws-weekly-update-reports', // ここは実際に使用するベース名に変更するのじゃ
  lambdaFunctionName: 'GenerateAwsWeeklyUpdateReport', // オプション
  // reportOutputS3KeyPrefix: 'custom-reports/', // オプション
  // rssFeedUrl: 'YOUR_CUSTOM_RSS_FEED_URL', // オプション
  scheduleExpression: 'cron(0 1 ? * TUE *)', // オプション
  // lambdaTimeoutSeconds: 120, // オプション
  // lambdaMemoryMB: 512, // オプション
};

// わらわが定義したスタックを 'CdkStack' という名前でインスタンス化
new AwsWeeklyReportCdkStack(app, 'CdkStack', stackProps);

// app.synth(); // cdk deploy や cdk synth コマンドが内部で実行するので、通常は不要
