require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'cidade-dorme-secret',
    resave: false,
      saveUninitialized: false
      }));

      app.use(passport.initialize());
      app.use(passport.session());

      passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.CALLBACK_URL || '/auth/google/callback'
            }, (accessToken, refreshToken, profile, done) => {
              return done(null, profile);
              }));

              passport.serializeUser((user, done) => done(null, user));
              passport.deserializeUser((user, done) => done(null, user));

              app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

              app.get('/auth/google/callback',
                passport.authenticate('google', { failureRedirect: '/' }),
                  (req, res) => res.redirect('/')
                  );

                  app.get('/auth/logout', (req, res) => {
                    req.logout(() => res.redirect('/'));
                    });

                    app.get('/api/me', (req, res) => {
                      if (req.isAuthenticated()) {
                          res.json({ user: req.user });
                            } else {
                                res.json({ user: null });
                                  }
                                  });

                                  app.get('*', (req, res) => {
                                    res.sendFile(path.join(__dirname, 'public', 'index.html'));
                                    });

                                    io.on('connection', (socket) => {
                                      console.log('usuario conectado:', socket.id);
                                        socket.on('disconnect', () => {
                                            console.log('usuario desconectado:', socket.id);
                                              });
                                              });

                                              const PORT = process.env.PORT || 3000;
                                              httpServer.listen(PORT, () => console.log(`Cidade Dorme rodando na porta ${PORT}`));
