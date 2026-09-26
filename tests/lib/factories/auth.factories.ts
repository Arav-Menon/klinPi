import {randomUUID} from "crypto";

type User = {
    id: string;
    email: string;
    name: string;
    password: string;
    createdAt: Date;
};

export function createUser(overrides: Partial<User> = {}): User {
    return {
        id: randomUUID(),
        email: "test@test.com",
        name: "test-user",
        password: "hashed-password",
        createdAt: new Date(),
        ...overrides,
    };
}