#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsWeeklyReportCdkStack } from '../lib/aws-weekly-report-cdk-stack';

const app = new cdk.App();

const stackProps = {
  reportOutputS3BucketBaseName: 'generated-aws-weekly-update-reports',
  lambdaFunctionName: 'GenerateAwsWeeklyUpdateReport',
  scheduleExpression: 'cron(0 22 ? * SUN *)', // 毎週月曜 07:00 JST (日曜 22:00 UTC)
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
  alertEmail: process.env.ALERT_EMAIL,
};

new AwsWeeklyReportCdkStack(app, 'GenerateAwsWeeklyUpdateReport', stackProps);
