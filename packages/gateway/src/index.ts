import { PORT } from "@klinpi/common";
import app from "./app.js";

app.listen(PORT, () => {
  console.log(`Gateway running on http://localhost:${PORT}`);
});
