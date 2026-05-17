#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DoorbellStack } from '../lib/doorbell-stack';

const app = new cdk.App();

const phoneInput = app.node.tryGetContext('phone') as string | undefined;
const phoneNumbers = phoneInput
  ? phoneInput.split(',').map(p => p.trim())
  : ['+15551234567'];

new DoorbellStack(app, 'CommunityDoorbell', {
  phoneNumbers,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
