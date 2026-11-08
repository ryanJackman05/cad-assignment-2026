import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  ddb,
  isRoleItem,
  movieKey,
  parseId,
  tableName,
  toRole,
} from "../shared/db";
import { response } from "../shared/http";
import { logRequest } from "../shared/request-logger";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logRequest(event);

  const movieId = parseId(event.pathParameters?.movieID);
  if (movieId === undefined) {
    return response(400, { message: "movieID must be a positive integer" });
  }
  // Optional Actor param
  const actorParam = event.queryStringParameters?.actor;
  const actorId = parseId(actorParam);
  if (actorParam !== undefined && actorId === undefined) {
    return response(400, { message: "actor must be a positive integer" });
  } 

  try {
    const queryResult = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": movieKey(movieId) },
        // ExclusiveStartKey: lastKey,
      })
    );

    const resultItems = queryResult.Items ?? [];
    if (actorId !== undefined) {
      const roleItem = resultItems.find(
        (item) => item.SK === `a#${actorId}`
      );
      if (!roleItem) {
        return response(404, { message: `No role found for actor ${actorId} on movie ${movieId}` });
      }
      return response(200, { data: [toRole(roleItem)] }); // TODO - toActor/toRole always return an object, so null checks may be a good idea
    }

    return response(200, { data: resultItems.filter(isRoleItem).map(toRole) });
  } catch (err) {
    console.error("DynamoDB error:", err);
    return response(500, {message: "Internal server error"});
  }
};
