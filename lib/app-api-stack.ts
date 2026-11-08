import * as cdk from 'aws-cdk-lib/core';
import * as apig from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as node from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { marshall } from '@aws-sdk/util-dynamodb';
import { Construct } from 'constructs';
import { seedItems } from '../seed/movie-cast';

export interface AppApiStackProps extends cdk.StackProps {
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
}

export class AppApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AppApiStackProps) {
    super(scope, id, props);

    // Tables
    // Movie - PK = m#movieID, SK = m#movieID.
    // Actor - PK = a#actorID, SK = a#actorID.
    // Role - PK = m#movieID, SK = a#actorID.
    const table = new dynamodb.TableV2(this, 'MovieCastTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const appFn = (name: string, entry: string, environment: Record<string, string> = {}) =>
      new node.NodejsFunction(this, name, {
        architecture: lambda.Architecture.ARM_64,
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: `${__dirname}/../lambdas/${entry}`,
        timeout: cdk.Duration.seconds(10),
        memorySize: 128,
        environment: {
          TABLE_NAME: table.tableName,
          REGION: this.region,
          ...environment,
        },
      });

    // Lambdas
    const getMovieRolesFn = appFn('GetMovieRolesFn', 'app/get-movie-roles.ts');
    const getActorFn = appFn('GetActorFn', 'app/get-actor.ts');
    const addMovieRoleFn = appFn('AddMovieRoleFn', 'app/add-movie-role.ts');
    const authorizerFn = appFn('AuthorizerFn', 'auth/authorizer.ts', {
      USER_POOL_ID: props.userPool.userPoolId,
      CLIENT_ID: props.userPoolClient.userPoolClientId,
    });

    table.grantReadData(getMovieRolesFn);
    table.grantReadData(getActorFn);
    table.grantReadWriteData(addMovieRoleFn);

    // Sample data, written once when the stack is created.
    const items = seedItems();
    if (items.length > 25) throw new Error('BatchWriteItem accepts at most 25 items');
    const seeder = new cr.AwsCustomResource(this, 'SeedMovieCastData', {
      onCreate: {
        service: 'DynamoDB',
        action: 'BatchWriteItem',
        parameters: {
          RequestItems: {
            [table.tableName]: items.map((item) => ({ PutRequest: { Item: marshall(item) } })),
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of('MovieCastSeedData'),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: [table.tableArn] }),
      installLatestAwsSdk: false,
    });

    const userAuthorizer = new apig.RequestAuthorizer(this, 'UserAuthorizer', {
      handler: authorizerFn,
      identitySources: [apig.IdentitySource.header('cookie')],
      resultsCacheTtl: cdk.Duration.minutes(0),
    });

    const api = new apig.RestApi(this, 'AppApi', {
      description: 'Movie cast API',
      endpointTypes: [apig.EndpointType.REGIONAL],
      deployOptions: { stageName: 'dev' },
      defaultCorsPreflightOptions: {
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
        allowMethods: ['OPTIONS', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        allowCredentials: true,
        allowOrigins: ['*'],
      },
    });

    const userAuth: apig.MethodOptions = {
      authorizer: userAuthorizer,
      authorizationType: apig.AuthorizationType.CUSTOM,
    };

    const adminAuth: apig.MethodOptions = {
      authorizationType: apig.AuthorizationType.NONE,
      apiKeyRequired: true,
    };

    // API key generated at deploy time (from API/API Gateway)
    const adminApiKey = api.addApiKey('AdminApiKey');

    // print the key's AWS ID to the console
    new cdk.CfnOutput(this, 'AdminApiKeyId', { value: adminApiKey.keyId });

    // Routes
    /* The Web API will support the following endpoints:

    GET /movies/{movieID}/roles?[actor=actorID] - Get details of all roles for the specified movie.
    Support an optional query string parameter that specifies an actor ID, e.g. ?actor=4321. 
    Only the role played by that actor in the movie should now be returned, if relevant.

    GET /actors/{actorID}?[movie=movieID] - Return the specified actor's profile (DOB, bio, etc).
    Support an optional query string parameter that specifies a movie ID. 
    The response should now also include the description of the actor's role in the specified movie, if relevant.

    POST /movies/roles - add a movie role. */

    const moviesResource = api.root.addResource('movies');

    moviesResource
      .addResource('{movieID}')
      .addResource('roles')
      .addMethod('GET', new apig.LambdaIntegration(getMovieRolesFn), userAuth);

    moviesResource
      .addResource('roles')
      .addMethod('POST', new apig.LambdaIntegration(addMovieRoleFn), adminAuth);

    api.root
      .addResource('actors')
      .addResource('{actorID}')
      .addMethod('GET', new apig.LambdaIntegration(getActorFn), userAuth);
  }
}
