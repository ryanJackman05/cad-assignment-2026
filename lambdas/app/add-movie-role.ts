import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { actorKey, ddb, movieKey, type Role, tableName } from "../shared/db";
import { isResponse, parseJsonObject, response, createDDbDocClient } from "../shared/http";

const ddbDocClient = createDDbDocClient();

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const body = parseJsonObject(event);
  if (isResponse(body)) return body;

  const role: Role = {
    movieId: body.movieId as number,
    actorId: body.actorId as number,
    roleName: body.roleName as string,
    roleDescription: body.roleDescription as string,
  };

  try {
    // Check if its IDs are valid
    const actorResult = await ddb.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: actorKey(role.actorId), SK: actorKey(role.actorId) },
      })
    );
    if (!actorResult.Item) {
      return response(400, { message: `Actor ${role.actorId} does not exist` });
    }

    const movieResult = await ddb.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: movieKey(role.movieId), SK: movieKey(role.movieId) },
      })
    );
    if (!movieResult.Item) {
      return response(400, { message: `Movie ${role.movieId} does not exist` });
    }

    await ddbDocClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: process.env.TABLE_NAME,
              Key: { PK: movieKey(role.movieId), 
                SK: movieKey(role.movieId) }, // added sortKey to specify Role item keys
              ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
            },
          },
          {
            Put: {
              TableName: process.env.CAST_TABLE_NAME,
              Item: body,
            },
          },
        ],
      })
    );
    return response(201, { message: "Role added", data: role });
  } catch (err) {
    console.error("DynamoDB error:", err);
    return response(500, {
      message: "Internal server error",
      error: err,
    });
  }
};
