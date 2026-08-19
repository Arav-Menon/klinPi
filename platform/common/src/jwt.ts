import jwt from "jsonwebtoken";

const JWT_EXPIRES_IN = "15m";

function getJwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    console.log(secret)
    if (!secret) {
        throw new Error("JWT_SECRET environment variable is required");
    }
    return secret;
}

export interface JwtPayload {
    sub: string;
}

export function signToken(userId: string): string {
    const payload: JwtPayload = {sub: userId};
    return jwt.sign(payload, getJwtSecret(), {expiresIn: JWT_EXPIRES_IN});
}

export function verifyToken(token: string): JwtPayload {
    return jwt.verify(token, getJwtSecret()) as JwtPayload;
}
