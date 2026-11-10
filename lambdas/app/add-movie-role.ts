import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { actorKey, movieKey, type Role, tableName, parseId } from "../shared/db";
import { isResponse, parseJsonObject, response, createDDbDocClient } from "../shared/http";
import { logRequest } from "../shared/request-logger";

const ddbDocClient = createDDbDocClient();

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const body = parseJsonObject(event);
  if (isResponse(body)) return body;

  logRequest(event);

  const movieId = parseId(body.movieId as string);
  if (movieId === undefined) {
    return response(400, { message: "movieID must be a positive integer" });
  }
  const actorId = parseId(body.actorId as string);
  if (actorId === undefined) {
    return response(400, { message: "actorID must be a positive integer" });
  }

  const role: Role = {
    movieId: body.movieId as number,
    actorId: body.actorId as number,
    roleName: body.roleName as string,
    roleDescription: body.roleDescription as string,
  };

  try {
    // Check if its IDs are valid
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
    if (err instanceof TransactionCanceledException) { // implicit cast to err type allows easy access to CancellationReasons

      const reasons = err.CancellationReasons ?? []; // returns empty if undefined
      if(reasons[0]?.Code === "ConditionalCheckFailed") {
        return response(404, { message: `Movie ${role.movieId} does not exist` });
      }
      if(reasons[1]?.Code === "ConditionalCheckFailed") {
        return response(404, { message: `Actor ${role.actorId} does not exist` });
      }
      if(reasons[2]?.Code === "ConditionalCheckFailed") {
        return response(409, { message: "Actor already has a role in this movie" }); // 409 conflict
      }
    }
    // if none of the previous checks apply to this error, return a generic 500 error
    console.error("DynamoDB error:", err); // err should only be logged internally, not returned to the client
    return response(500, {
      message: "Internal server error"
    });
  }
};
