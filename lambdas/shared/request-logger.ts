import type { APIGatewayProxyEvent } from 'aws-lambda';

// Logs "<cognito username>   <request path>[?query]" to CloudWatch, e.g.
//   doconnor   /actors/4321?movie=1234
export const logRequest = (event: APIGatewayProxyEvent): void => {
  // user name found at "requestContext": { "authorizer": { "username": "rj"))) }
  // adminId found at "requestContext": { "identity": { "apiKeyId": "rj"))) }
  const username = "User: "+ (event.requestContext.authorizer?.username ?? 'unknownUser');
  const adminId = "Admin: "+ (event.requestContext.identity?.apiKeyId ?? 'unknownAdmin');

  const params = Object.entries(event.queryStringParameters ?? {}).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  const query = params.length ? `?${new URLSearchParams(params)}` : '';
  console.log(`${adminId !== "Admin: unknownAdmin" ? adminId: username}   ${event.path}${query}`);
  //console.log(`WHOLE EVENT ${JSON.stringify(event)}`); <<< I used this to read the event object to find the user ID locations. Now removed for security
};
