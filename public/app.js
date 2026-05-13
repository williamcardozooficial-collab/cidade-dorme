const socket = io();

async function checkAuth() {
  const res = await fetch('/api/me');
    const data = await res.json();

      if (data.user) {
          showHome(data.user);
            } else {
                showLogin();
                  }
                  }

                  function showLogin() {
                    document.getElementById('login-screen').classList.add('active');
                      document.getElementById('home-screen').classList.remove('active');
                      }

                      function showHome(user) {
                        document.getElementById('login-screen').classList.remove('active');
                          document.getElementById('home-screen').classList.add('active');

                            const name = user.displayName || user.name || 'Jogador';
                              const photo = (user.photos && user.photos[0]) ? user.photos[0].value : '';

                                document.getElementById('welcome-name').textContent = name.split(' ')[0];
                                  document.getElementById('user-name').textContent = name.split(' ')[0];

                                    const avatar = document.getElementById('user-avatar');
                                      if (photo) {
                                          avatar.src = photo;
                                              avatar.style.display = 'block';
                                                }
                                                }

                                                document.getElementById('card-criar').addEventListener('click', () => {
                                                  alert('Em breve: Criar Sala!');
                                                  });

                                                  document.getElementById('card-entrar').addEventListener('click', () => {
                                                    alert('Em breve: Entrar em Sala!');
                                                    });

                                                    checkAuth();