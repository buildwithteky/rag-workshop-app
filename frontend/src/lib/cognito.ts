import { CognitoUserPool } from "amazon-cognito-identity-js";

const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;

let pool: CognitoUserPool | null = null;

export function getUserPool(): CognitoUserPool {
  if (!userPoolId || !clientId) {
    throw new Error(
      "Cognito is not configured. Set NEXT_PUBLIC_COGNITO_USER_POOL_ID and NEXT_PUBLIC_COGNITO_CLIENT_ID."
    );
  }
  if (!pool) {
    pool = new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId });
  }
  return pool;
}
