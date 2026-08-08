import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import app from "./app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const PORT = process.env.PORT || 3100;

app.listen(PORT, () => {
  console.log(`Gateway running on http://localhost:${PORT}`);
});
