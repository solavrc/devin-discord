import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class DevinDiscordSecretStack extends cdk.Stack {
  public readonly secret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.secret = new secretsmanager.Secret(this, 'Secret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          // cdk.context.json に設定された値を使用
          DISCORD_BOT_TOKEN: this.node.tryGetContext('DISCORD_BOT_TOKEN'),
          DEVIN_API_KEY: this.node.tryGetContext('DEVIN_API_KEY'),
        }),
        generateStringKey: 'DUMMY_KEY',
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}
