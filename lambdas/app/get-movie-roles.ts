import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  ddb,
  isRoleItem,
  movieKey,
  actorKey,
  parseId,
  tableName,
  toRole,
} from "../shared/db";
import { response } from "../shared/http";
import { logRequest } from "../shared/request-logger";

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logRequest(event);

  const movieId = parseId(event.pathParameters?.movieID);
  if (movieId === undefined) {
    return response(400, { message: "movieID must be a positive integer" });
  }
  // Optional Actor param
  const actorParam = event.queryStringParameters?.actor;
  const actorId = parseId(actorParam);
  if (actorParam !== undefined && actorId === undefined) {
    return response(400, { message: "actorID must be a positive integer" });
  } 

  try {
    // for outputs to be added to
    let lastKey: Record<string, any> | undefined; // | undefined allows for undefined on first iteration
    let resultItems: Record<string, any>[] = [];

    do {
      const queryResult = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": movieKey(movieId) },
        ExclusiveStartKey: lastKey
      }));

      resultItems = resultItems.concat(queryResult.Items ?? []);
      lastKey = queryResult.LastEvaluatedKey;  // queryresult.LastEvaluatedKey is undefined if there are no more results, which will break the loop
    } while (lastKey)


    if(resultItems.length === 0) { // there will be at least one item if a movie exists
      return response(404, { message: `Movie ${movieId} not found` });
    }

    if (actorId !== undefined) {
      const roleItem = resultItems.find( // extracts the correct role from the array (which should consist of Role/Movie)
        (item) => item.SK === actorKey(actorId)
      );
      if (!roleItem) {
        return response(404, { message: `No role found for actor ${actorId} on movie ${movieId}` });
      }
      return response(200, { data: [toRole(roleItem)] });
    }

    return response(200, { data: resultItems.filter(isRoleItem).map(toRole) }); // maps and returns roles only, ignores movie object
  } catch (err) {
    console.error("DynamoDB error:", err);
    return response(500, {message: "Internal server error"});
  }
};
