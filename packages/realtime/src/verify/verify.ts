import {verifyToken, type JwtPayload} from "@klinpi/common";

export function verify(token: string): JwtPayload | null {
    try {
        return verifyToken(token);
    } catch {
        return null;
    }
}
