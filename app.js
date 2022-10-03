"use strict";

require("dotenv").config();

const NodeCache = require("node-cache");
const cookieParser = require("cookie-parser");
const express = require("express");
const nunjucks = require("nunjucks");
const path = require("path");
const session = require("express-session");
const { default: axios } = require("axios");
const { randomUUID } = require("crypto");

//
// Constants
//

const app = express();
const port = process.env.PORT || 3000;
const stateKey = "github_auth_state";
const cache = new NodeCache({ stdTTL: 100, checkperiod: 120 });

const sessionSettings = {
  cookie: { maxAge: 1000 * 60 * 60 * 24 },
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
  if (!token) return void res.render("index");
  res.redirect("/repos");
}

/**
 * Handle the /repos route.
 * @param {express.Request} req The Request object.
 * @param {express.Response} res The Response object.
 */
function repos(req, res) {
  const { token } = req.session;
  if (!token) return void res.redirect("/");

  const repos = cache.get("repos");

  if (repos) {
    console.log("Serving cached data");
    return void res.render("repos", { repos });
  }

  const requestConfig = {
    method: "get",
    headers: { Authorization: `token ${token}` },
    url: `https://api.github.com/user/repos`,
  };

  axios(requestConfig)
    .then(({ data: repos }) => {
      console.log("Serving fresh data");
      cache.set("repos", repos);
      res.render("repos", { repos });
    })
    .catch((error) => {
      console.error("Something went wrong:", error);
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

  res.cookie(stateKey, state);
  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
}

/**
 * Handle the /logout route.
 * @param {express.Request} _req The Request object.
 * @param {express.Response} res The Response object.
 * @param {express.NextFunction} next The next function in the request-response cycle.
 */
function logout(req, res, next) {
  delete req.session.token;

  // Save to ensure that re-using the old session ID
  // does not have a logged in user.
  req.session.save((error) => {
    if (error) next(error);

    // Regenerate the session, which is good practice to help
    // guard against forms of session fixation.
    req.session.regenerate((error) => {
      if (error) next(error);
      res.redirect("/");
    });
  });
}

/**
 * Handle the /callback route.
 * @param {express.Request} req The Request object.
 * @param {express.Response} res The Response object.
 * @param {express.NextFunction} next The next function in the request-response cycle.
 */
function callback(req, res, next) {
  const { code, state } = req.query;
  const savedState = req.cookies?.[stateKey];

  // If the states don't match, then a third party created the request,
  // and we should abort the process.
  if (!state || state !== savedState) return void res.redirect("/");

  // Regenerate the session, which is good practice to help
  // guard against forms of session fixation.
  req.session.regenerate((error) => {
    if (error) next(error);

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

    res.clearCookie(stateKey);

    axios(requestConfig)
      .then(({ data }) => {
        // Store access token in session.
        req.session.token = data.access_token;

        // Save the session before redirection to ensure page
        // load does not happen before session is saved.
        req.session.save((error) => {
          if (error) return void next(error);
          res.redirect("/repos");
        });
      })
      .catch((error) => {
        console.error("Something went wrong:", error);
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

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "njk");

app.use(express.static(path.join(__dirname, "public")));
app.use(session(sessionSettings));

app.get("/", index);
app.get("/repos", repos);
app.get("/login", login);
app.get("/logout", logout);
app.get("/callback", cookieParser(), callback);

app.listen(port, () => {
  console.log(`Listening at http://localhost:${port} ...`);
});
