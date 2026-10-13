// Backend address. Set REACT_APP_API_URL in frontend/.env to use a different backend.
export const API_URL = (process.env.REACT_APP_API_URL || "https://studyscribe.onrender.com").replace(/\/$/, "");
