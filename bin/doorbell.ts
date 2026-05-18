#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DoorbellStack } from '../lib/doorbell-stack';

const app = new cdk.App();

const phoneInput = app.node.tryGetContext('phone') as string | undefined;
const emailInput = app.node.tryGetContext('email') as string | undefined;
const ntfyTopic = app.node.tryGetContext('ntfy') as string | undefined;
const domainName = app.node.tryGetContext('domain') as string | undefined;
const hostedZoneId = app.node.tryGetContext('hostedZoneId') as string | undefined;
const googleClientId = app.node.tryGetContext('googleClientId') as string | undefined;
const googleClientSecret = app.node.tryGetContext('googleClientSecret') as string | undefined;
const adminEmailInput = app.node.tryGetContext('adminEmails') as string | undefined;

const phoneNumbers = phoneInput
  ? phoneInput.split(',').map(p => p.trim())
  : undefined;

const emailAddresses = emailInput
  ? emailInput.split(',').map(e => e.trim())
  : undefined;

const adminEmails = adminEmailInput
  ? adminEmailInput.split(',').map(e => e.trim())
  : undefined;

if (!phoneNumbers && !emailAddresses && !ntfyTopic) {
  throw new Error('Provide at least one of -c phone=..., -c email=..., or -c ntfy=...');
}

new DoorbellStack(app, 'CommunityDoorbell', {
  phoneNumbers,
  emailAddresses,
  ntfyTopic,
  domainName,
  hostedZoneId,
  googleClientId,
  googleClientSecret,
  adminEmails,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
