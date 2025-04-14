#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { DevinDiscordStack } from '../lib/devin-discord-stack'
import { DevinDiscordSecretStack } from '../lib/devin-discord-secret-stack'
import { Environment } from 'aws-cdk-lib'

const env: Environment = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
const app = new cdk.App()
const secretStack = new DevinDiscordSecretStack(app, 'DevinDiscordSecretStack', { env })
const mainStack = new DevinDiscordStack(app, 'DevinDiscordStack', { env, secret: secretStack.secret })
mainStack.addDependency(secretStack)
