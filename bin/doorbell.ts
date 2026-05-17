#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DoorbellStack } from '../lib/doorbell-stack';

const app = new cdk.App();

const phoneInput = app.node.tryGetContext('phone') as string | undefined;
const emailInput = app.node.tryGetContext('email') as string | undefined;

const phoneNumbers = phoneInput
  ? phoneInput.split(',').map(p => p.trim())
  : undefined;

const emailAddresses = emailInput
  ? emailInput.split(',').map(e => e.trim())
  : undefined;

if (!phoneNumbers && !emailAddresses) {
  throw new Error('Provide at least one of -c phone=... or -c email=...');
}

new DoorbellStack(app, 'CommunityDoorbell', {
  phoneNumbers,
  emailAddresses,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
