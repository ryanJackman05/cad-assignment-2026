import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { actorKey, ddb, movieKey, type Role, tableName } from "../shared/db";
import { isResponse, parseJsonObject, response, createDDbDocClient } from "../shared/http";

const ddbDocClient = createDDbDocClient();

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
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

    const movieResult = await ddb.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: movieKey(role.movieId), SK: movieKey(role.movieId) },
      })
    );

    await ddbDocClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            // Movie must exist
            ConditionCheck: {
              TableName: tableName,
              Key: { 
                PK: movieKey(role.movieId), 
                SK: movieKey(role.movieId) },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            // Actor must exist
            ConditionCheck: {
              TableName: tableName,
              Key: { 
                PK: actorKey(role.actorId), 
                SK: actorKey(role.actorId) },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            // Create the role, but don't overwrite an existing one
            Put: {
              TableName: tableName,
              Item: {
                PK: movieKey(role.movieId),
                SK: actorKey(role.actorId),
                ...role,
              },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      })
    );
    return response(201, { message: "Role added", data: role });
  } catch (err) {
    if (err instanceof TransactionCanceledException) {

      const reasons = err.CancellationReasons ?? []; // returns empty if undefined
      if(reasons[0]?.Code === "ConditionalCheckFailed") {
        return response(400, { message: `Movie ${role.movieId} does not exist` });
      }
      if(reasons[1]?.Code === "ConditionalCheckFailed") {
        return response(400, { message: `Actor ${role.actorId} does not exist` });
      }
      if(reasons[2]?.Code === "ConditionalCheckFailed") {
        return response(409, { message: "Actor already has a role in this movie" }); // 409 conflict
      }
      return response(400, { message: "Transaction failed", reasons }); // unlikely to hit, check if necessary
    }
    // if none of the previous checks apply to this error, return a generic 500 error
    console.error("DynamoDB error:", err); // err should only be logged internally, not returned to the client
    return response(500, {
      message: "Internal server error"
    });
  }
};
