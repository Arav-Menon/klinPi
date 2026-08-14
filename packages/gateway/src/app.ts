import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./modules/routes/auth.routes.js";

const app: ReturnType<typeof express> = express();

app.use(cors({
    origin: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000",
    credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (req, res) => {
    res.json({status: "ok", service: "klinpi-gateway"});
});

app.use("/api/v1/auth", authRoutes);

export default app;