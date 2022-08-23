import "dotenv/config";
import NodeCache from "node-cache";
import axios from "axios";
import cookieParser from "cookie-parser";
import express from "express";
import { fileURLToPath } from "url";
import nunjucks from "nunjucks";
import { randomUUID } from "crypto";
import session from "express-session";

//
// Constants
//

const __DIRNAME = fileURLToPath(new URL(".", import.meta.url));
const STATE_KEY = "github_auth_state";

const cache = new NodeCache({ stdTTL: 100, checkperiod: 120 });

const app = express();
const cookieware = cookieParser();

const sessionSettings = {
  cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 1 day
  resave: false,
  saveUninitialized: true,
  secret: process.env.SESSION_SECRET,
};

//
// Functions
//

/**
 * Handle the / route.
 * @param {express.Request} req The Request object.
 * @param {express.Response} res The Response object.
 */
function index(req, res) {
  const { token } = req.session;

  if (token) {
    res.redirect("/repos");
    return;
  }

  res.render("index");
}

/**
 * Handle the /repos route.
 * @param {express.Request} req The Request object.
 * @param {express.Response} res The Response object.
 */
function repos(req, res) {
  const { token } = req.session;

  if (!token) {
    res.redirect("/");
    return;
  }

  const cachedRepos = cache.get("repos");

  if (cachedRepos) {
    console.log("Serving cached data");
    res.render("repos", { repos: cachedRepos });
    return;
  }

  const requestConfig = {
    method: "get",
    headers: { Authorization: `token ${token}` },
    url: `https://api.github.com/user/repos`,
  };

  axios(requestConfig)
    .then(function ({ data: repos }) {
      console.log("Serving fresh data");
      cache.set("repos", repos);
      res.render("repos", { repos });
    })
    .catch(function (error) {
      console.log("Something went wrong:", error);
      res.redirect("/");
    });
}

/**
 * Handle the /login route.
 * @param {express.Request} _req The Request object.
 * @param {express.Response} res The Response object.
 */
function login(_req, res) {
  const state = randomUUID();
  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    scope: "repo",
    state,
  });

  res.cookie(STATE_KEY, state);
  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
}

/**
 * Handle the /callback route.
 * @param {express.Request} req The Request object.
 * @param {express.Response} res The Response object.
 * @param {express.NextFunction} next The next function in the request-response cycle.
 */
function callback(req, res, next) {
  const { code, state } = req.query;
  const storedState = req.cookies?.[STATE_KEY];

  // If the states don't match, then a third party created the request,
  // and we should abort the process.
  if (!state || state !== storedState) {
    res.redirect("/");
    return;
  }

  // Regenerate the session, which is good practice to help
  // guard against forms of session fixation.
  req.session.regenerate((err) => {
    if (err) next(err);

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
      .then(function ({ data: { access_token } }) {
        // Store access token in session.
        req.session.token = access_token;

        // Save the session before redirection to ensure page
        // load does not happen before session is saved.
        req.session.save((err) => {
          if (err) return next(err);
          res.redirect("/repos");
        });
      })
      .catch(function (err) {
        console.log("Something went wrong:", err);
        res.redirect("/");
      });
  });
}

//
// Inits
//

nunjucks.configure("views", {
  autoescape: true,
  express: app,
});

app.set("views", "./views");
app.set("view engine", "njk");

app.use(express.static(`${__DIRNAME}/public`));
app.use(session(sessionSettings));

app.get("/", index);
app.get("/repos", repos);
app.get("/login", login);
app.get("/callback", cookieware, callback);

app.listen(process.env.PORT, () => {
  console.log(`Listening at http://localhost:${process.env.PORT}...`);
});
