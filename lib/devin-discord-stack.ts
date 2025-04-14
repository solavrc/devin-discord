import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import {
  RemovalPolicy,
  IgnoreMode,
  aws_ec2 as ec2,
  aws_ecr_assets as ecra,
  aws_ecs as ecs,
  aws_logs as logs,
  aws_secretsmanager as secretsmanager,
} from 'aws-cdk-lib'

export interface DevinDiscordStackProps extends cdk.StackProps {
  readonly secret: secretsmanager.ISecret
}

export class DevinDiscordStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DevinDiscordStackProps) {
    super(scope, id, props)

    const logGroup = new logs.LogGroup(this, 'LogGroup', { removalPolicy: RemovalPolicy.DESTROY })
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: ec2.Vpc.fromLookup(this, 'Vpc', { isDefault: true }),
      containerInsights: false,
    })
    const taskDefinition = new ecs.TaskDefinition(this, 'TaskDefinition', {
      compatibility: ecs.Compatibility.FARGATE,
      cpu: '256',
      memoryMiB: '512',
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    })
    taskDefinition.addContainer('Container', {
      image: ecs.ContainerImage.fromAsset('./', {
        platform: ecra.Platform.LINUX_ARM64,
        ignoreMode: IgnoreMode.GIT,
        file: 'Dockerfile',
      }),
      secrets: {
        DISCORD_BOT_TOKEN: ecs.Secret.fromSecretsManager(props.secret, 'DISCORD_BOT_TOKEN'),
        DEVIN_API_KEY: ecs.Secret.fromSecretsManager(props.secret, 'DEVIN_API_KEY'),
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'devin-discord', logGroup }),
    })
    new ecs.FargateService(this, 'Service', {
      cluster,
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      enableExecuteCommand: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      circuitBreaker: { rollback: true },
    })
  }
}
