import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  actorKey,
  movieKey,
  ddb,
  parseId,
  tableName,
  toActor,
  toRole,
} from "../shared/db";
import { response } from "../shared/http";
import { logRequest } from "../shared/request-logger";

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logRequest(event);

  const actorId = parseId(event.pathParameters?.actorID);
  if (actorId === undefined) {
    return response(400, { message: "actorID must be a positive integer" });
  }

  const movieParam = event.queryStringParameters?.movie;
  const movieId = parseId(movieParam);
  if (movieParam !== undefined && movieId === undefined) {
    return response(400, { message: "movieID must be a positive integer" });
  }
  
  try {
    const [actorResult, roleResult] = await Promise.all([
      ddb.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: actorKey(actorId), SK: actorKey(actorId) },
        })
      ),
      movieId === undefined
        ? undefined // return nothing if no movieId is provided
        : ddb.send(
            new GetCommand({
              TableName: tableName,
              Key: { PK: movieKey(movieId), SK: actorKey(actorId) },
            })
          ),
    ]);

    if (!actorResult.Item) {
      return response(404, { message: `Actor ${actorId} not found` });
    }
    if(!roleResult?.Item && movieId !== undefined) { // fail response only needed if movieId is provided
      return response(404, { message: `No role found for actor ${actorId} on movie ${movieId}` }); 
    }

    const actor = toActor(actorResult.Item);
    const role = roleResult?.Item ? toRole(roleResult.Item) : undefined; // undefined check required due to roleResult
    
    return response(200, { data: role ? { actor, role } : { actor } });
    
  } catch (err) {
    console.error("DynamoDB error:", err);
    return response(500, { message: "Internal server error"});
  }
};
