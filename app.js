import "dotenv/config";
import axios from "axios";
import cookieParser from "cookie-parser";
import express from "express";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

//
// Constants
//

const __DIRNAME = fileURLToPath(new URL(".", import.meta.url));
const STATE_KEY = "github_auth_state";

const app = express();

//
// Functions
//

function login(_req, res) {
  const state = randomUUID();
  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    scope: "repo",
    state,
  });

  res
    .cookie(STATE_KEY, state)
    .redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
}

function callback(req, res) {
  const { code, state } = req.query;
  const storedState = req.cookies?.[STATE_KEY];

  if (!state || state !== storedState) {
    res.redirect("/");
    return;
  }

  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    code,
  });

  const requestConfig = {
    method: "post",
    headers: { Accept: "application/json" },
    url: `https://github.com/login/oauth/access_token?${params.toString()}`,
  };

  res.clearCookie(STATE_KEY);

  axios(requestConfig)
    .then(function ({ data }) {
      res.redirect(`/app?token=${data.access_token}`);
    })
    .catch(function (error) {
      console.log("Something went wrong:", error);
      res.redirect("/");
    });
}

function listen(error) {
  if (error) {
    console.log("Something went wrong:", error);
    return;
  }

  console.log(`Listening on port ${process.env.PORT}...`);
}

//
// Inits
//

app
  .use(express.static(`${__DIRNAME}/public`))
  .use(cookieParser())
  .get("/login", login)
  .get("/callback", callback)
  .listen(process.env.PORT, listen);
