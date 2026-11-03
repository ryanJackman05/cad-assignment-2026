import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { marshall, marshallOptions, unmarshallOptions } from "@aws-sdk/util-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const response = (
  statusCode: number,
  body: object,
  headers: Record<string, string> = {},
): APIGatewayProxyResult => ({
  statusCode,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

export const isResponse = (value: object): value is APIGatewayProxyResult => 'statusCode' in value;

// Parses a JSON object request body, or returns a 400 response.
export const parseJsonObject = (
  event: APIGatewayProxyEvent,
): Record<string, unknown> | APIGatewayProxyResult => {
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return response(400, { message: 'Request body must be valid JSON' });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return response(400, { message: 'Request body must be a JSON object' });
  }
  return body as Record<string, unknown>;
};

export function createDDbDocClient() {
  const ddbClient = new DynamoDBClient({ region: process.env.REGION });
  const marshall : marshallOptions = {
    convertEmptyValues: true,
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  };
  const unmarshall:  unmarshallOptions = {
    wrapNumbers: false,
  };
  return DynamoDBDocumentClient.from(ddbClient, {
    marshallOptions: marshall, unmarshallOptions: unmarshall
  });
}