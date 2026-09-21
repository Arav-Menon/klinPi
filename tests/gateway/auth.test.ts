import {describe, it, beforeEach, expect} from "vitest";
import request from "supertest";
import app from "../../packages/gateway/src/app";
import {db} from "../../packages/gateway/src/lib/db";
import {users} from "@klinpi/db/schema";
import {eq, inArray} from "drizzle-orm";
import {createUser} from "../lib/factories/auth.factories";

describe("POST /signup", () => {
    beforeEach(async () => {
        const database = db();
        // Clean up ONLY the specific test users to prevent wiping active development data
        await database
            .delete(users)
            .where(
                inArray(users.email, [
                    "newuser@test.com",
                    "duplicate@test.com",
                    "short@password.com",
                ])
            );
    });

    it("should register a new user", async () => {
        const fakeUser = createUser({
            email: "newuser@test.com",
            name: "New User",
            password: "password123",
        });

        const response = await request(app)
            .post("/api/v1/auth/signup")
            .send({
                name: fakeUser.name,
                email: fakeUser.email,
                password: fakeUser.password,
            });

        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty("user");
        expect(response.body.user).toHaveProperty("id");
        expect(response.body.user.email).toBe(fakeUser.email);
        expect(response.body.user.name).toBe(fakeUser.name);
        expect(response.body.user).not.toHaveProperty("passwordHash");

        // Verify that the auth cookie was set correctly
        const cookies = response.headers["set-cookie"];
        expect(cookies).toBeDefined();
        const cookieList = Array.isArray(cookies) ? cookies : [cookies];
        const hasAuthToken = cookieList.some((cookie) => cookie && cookie.startsWith("klinpi_token="));
        expect(hasAuthToken).toBe(true);

        // Verify the user is stored in the database
        const database = db();
        const [dbUser] = await database
            .select()
            .from(users)
            .where(eq(users.email, fakeUser.email))
            .limit(1);
        expect(dbUser).not.toBeNull();
        expect(dbUser?.name).toBe(fakeUser.name);
    });

    it("should not register a user with an already registered email", async () => {
        const fakeUser = createUser({
            email: "duplicate@test.com",
            name: "First User",
            password: "password123",
        });

        // Insert first user into database via the signup endpoint
        await request(app)
            .post("/api/v1/auth/signup")
            .send({
                name: fakeUser.name,
                email: fakeUser.email,
                password: fakeUser.password,
            });

        // Try registering again with the same email
        const response = await request(app)
            .post("/api/v1/auth/signup")
            .send({
                name: "Second User",
                email: fakeUser.email,
                password: "anotherpassword",
            });

        expect(response.status).toBe(409);
        expect(response.body).toEqual({error: "User already exists"});
    });

    it("should fail validation if email is invalid", async () => {
        const response = await request(app)
            .post("/api/v1/auth/signup")
            .send({
                name: "Invalid Email User",
                email: "not-an-email",
                password: "password123",
            });

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty("error");
        expect(response.body.error).toContain("Invalid email address");
    });

    it("should fail validation if password is too short", async () => {
        const response = await request(app)
            .post("/api/v1/auth/signup")
            .send({
                name: "Short Password User",
                email: "short@password.com",
                password: "short",
            });

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty("error");
        expect(response.body.error).toContain("Password must be at least 8 characters");
    });
});

describe("POST /signin", () => {
    beforeEach(async () => {
        const database = db();
        await database
            .delete(users)
            .where(
                inArray(users.email, [
                    "newuser@test.com",
                    "duplicate@test.com",
                    "short@password.com",
                ])
            );
    });

    it("should login the existing user", async () => {
        const password = "password123";
        // Pre-computed bcrypt hash for "password123" with 12 rounds
        const passwordHash = "$2b$12$IIJd6p1/RWRSgCes86FCx.PWnExawsl1Lh7n3ZjlhGItBUjXKwMEC";

        // 1. Manually insert the user into the database
        const database = db();
        const [existingUser] = await database
            .insert(users)
            .values({
                email: "newuser@test.com",
                name: "New User",
                passwordHash,
            })
            .returning();

        // 2. Make the signin request
        const response = await request(app)
            .post("/api/v1/auth/signin")
            .send({
                email: existingUser!.email,
                password: password,
            });

        // 3. Assertions
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("user");
        expect(response.body.user.id).toBe(existingUser!.id);
        expect(response.body.user.email).toBe(existingUser!.email);
        expect(response.body.user.name).toBe(existingUser!.name);

        // Verify that the auth cookie was set correctly
        const cookies = response.headers["set-cookie"];
        expect(cookies).toBeDefined();
        const cookieList = Array.isArray(cookies) ? cookies : [cookies];
        const hasAuthToken = cookieList.some((cookie) => cookie && cookie.startsWith("klinpi_token="));
        expect(hasAuthToken).toBe(true);
    });

    it("should fail to login with an incorrect password", async () => {
        const passwordHash = "$2b$12$IIJd6p1/RWRSgCes86FCx.PWnExawsl1Lh7n3ZjlhGItBUjXKwMEC";

        const database = db();
        const [existingUser] = await database
            .insert(users)
            .values({
                email: "newuser@test.com",
                name: "New User",
                passwordHash,
            })
            .returning();

        const response = await request(app)
            .post("/api/v1/auth/signin")
            .send({
                email: existingUser!.email,
                password: "wrongpassword",
            });

        expect(response.status).toBe(401);
        expect(response.body).toEqual({error: "Invalid email or password"});
    });

    it("should fail to login if the user does not exist", async () => {
        const response = await request(app)
            .post("/api/v1/auth/signin")
            .send({
                email: "nonexistent@test.com",
                password: "password123",
            });

        expect(response.status).toBe(401);
        expect(response.body).toEqual({error: "Invalid email or password"});
    });
});
