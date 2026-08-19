import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./modules/routes/auth.routes.js";
import userRoutes from "./modules/routes/user.routes.js";
import sessionRoutes from "./modules/routes/session.routes.js";
import oauthRoutes from "./modules/routes/oauth.routes.js";

const app: ReturnType<typeof express> = express();

app.use(cors({
    origin: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000",
    credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (req, res) => {
    res.send({status: "ok", service: "klinpi-gateway"});
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/user", userRoutes);
app.use("/api/v1/sessions", sessionRoutes);
app.use("/api/v1/oauth", oauthRoutes);

export default app;