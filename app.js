import "dotenv/config";
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

const app = express();
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

  const requestConfig = {
    method: "get",
    headers: { Authorization: `token ${token}` },
    url: `https://api.github.com/user/repos`,
  };

  axios(requestConfig)
    .then(function ({ data: repos }) {
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

  res
    .cookie(STATE_KEY, state)
    .redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
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

// Template engine config
nunjucks.configure("views", {
  autoescape: true,
  express: app,
});

// Settings
app.set("views", "./views").set("view engine", "njk");

// Middleware
app
  .use(express.static(`${__DIRNAME}/public`))
  .use(cookieParser())
  .use(session(sessionSettings));

// Routes
app
  .get("/", index)
  .get("/repos", repos)
  .get("/login", login)
  .get("/callback", callback);

// Listener
app.listen(process.env.PORT, () => {
  console.log(`Listening on port ${process.env.PORT}...`);
});
