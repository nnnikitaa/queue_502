(() => {
  const config = window.APP_CONFIG || {};
  const SESSION_KEY = 'queue_session_v5';

  const authCard = document.querySelector('#authCard');
  const authForm = document.querySelector('#authForm');
  const authUsername = document.querySelector('#authUsername');
  const authPassword = document.querySelector('#authPassword');
  const authSubmit = document.querySelector('#authSubmit');
  const authMessage = document.querySelector('#authMessage');
  const loginTab = document.querySelector('#loginTab');
  const registerTab = document.querySelector('#registerTab');

  const userBar = document.querySelector('#userBar');
  const currentUsername = document.querySelector('#currentUsername');
  const logoutBtn = document.querySelector('#logoutBtn');

  const joinCard = document.querySelector('#joinCard');
  const joinForm = document.querySelector('#joinForm');
  const surnameInput = document.querySelector('#surname');
  const teacherSelect = document.querySelector('#teacher');
  const message = document.querySelector('#message');
  const template = document.querySelector('#personTemplate');

  let authMode = 'login';
  let session = loadSession();

  function loadSession() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (value && value.token && value.username) return value;
    } catch {}
    return null;
  }

  function saveSession(value) {
    session = value;
    if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else localStorage.removeItem(SESSION_KEY);
    updateAuthUi();
  }

  function setMsg(el, text, type = '') {
    el.textContent = text;
    el.className = `message ${type}`.trim();
  }

  const configured =
    config.SUPABASE_URL &&
    config.SUPABASE_ANON_KEY &&
    !config.SUPABASE_URL.includes('PASTE_') &&
    !config.SUPABASE_ANON_KEY.includes('PASTE_');

  if (!configured) {
    setMsg(authMessage, 'Не заполнены настройки Supabase в config.js', 'error');
    return;
  }

  const client = window.supabase.createClient(
    config.SUPABASE_URL,
    config.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  );

  async function rpc(name, params = {}) {
    const { data, error } = await client.rpc(name, params);
    if (error) throw error;
    return data;
  }

  function friendlyError(error) {
    const text = error?.message || String(error || 'Неизвестная ошибка');
    if (text.includes('username_taken')) return 'Такое имя пользователя уже занято';
    if (text.includes('invalid_credentials')) return 'Неверное имя пользователя или пароль';
    if (text.includes('invalid_username')) return 'Имя должно содержать от 2 до 40 символов';
    if (text.includes('invalid_password')) return 'Пароль должен содержать минимум 4 символа';
    if (text.includes('invalid_session')) return 'Сессия недействительна. Войдите ещё раз';
    if (text.includes('not_owner')) return 'Нельзя изменять чужую запись';
    if (text.includes('surname_already_exists')) return 'Такая фамилия уже есть в этой очереди';
    if (text.includes('row_not_found')) return 'Запись уже была изменена или удалена';
    return text;
  }

  function updateAuthUi() {
    const loggedIn = Boolean(session);
    authCard.hidden = loggedIn;
    userBar.hidden = !loggedIn;
    joinCard.hidden = !loggedIn;

    if (loggedIn) {
      currentUsername.textContent = session.username;
    }
  }

  function setAuthMode(mode) {
    authMode = mode;
    loginTab.classList.toggle('active', mode === 'login');
    registerTab.classList.toggle('active', mode === 'register');
    authSubmit.textContent = mode === 'login' ? 'Войти' : 'Зарегистрироваться';
    setMsg(authMessage, '');
  }

  loginTab.addEventListener('click', () => setAuthMode('login'));
  registerTab.addEventListener('click', () => setAuthMode('register'));

  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = authUsername.value.trim();
    const password = authPassword.value;

    authSubmit.disabled = true;

    try {
      const fn = authMode === 'login' ? 'queue_login_v4' : 'queue_register_v4';
      const result = await rpc(fn, {
        p_username: username,
        p_password: password
      });

      const row = Array.isArray(result) ? result[0] : result;
      if (!row?.session_token) throw new Error('invalid_session');

      saveSession({
        token: row.session_token,
        username: row.username
      });

      authPassword.value = '';
      setMsg(message, authMode === 'login' ? 'Вы вошли в систему' : 'Аккаунт создан', 'success');
      await loadQueues();
    } catch (error) {
      setMsg(authMessage, friendlyError(error), 'error');
    } finally {
      authSubmit.disabled = false;
    }
  });

  logoutBtn.addEventListener('click', async () => {
    const oldToken = session?.token;
    saveSession(null);

    if (oldToken) {
      try {
        await rpc('queue_logout_v4', { p_session_token: oldToken });
      } catch {}
    }

    await loadQueues();
  });

  function renderQueue(teacherId, rows) {
    const host = document.querySelector(`#queue${teacherId}`);
    const empty = document.querySelector(`#empty${teacherId}`);
    const count = document.querySelector(`#count${teacherId}`);

    host.innerHTML = '';
    count.textContent = String(rows.length);
    empty.hidden = rows.length > 0;

    rows.forEach((row, index) => {
      const fragment = template.content.cloneNode(true);
      const card = fragment.querySelector('.person-row');
      const actions = fragment.querySelector('.actions');
      const ownerName = fragment.querySelector('.owner-name');

      fragment.querySelector('.position').textContent = String(index + 1);
      fragment.querySelector('.surname').textContent = row.surname;

      if (row.owner_username) {
        ownerName.textContent = `Пользователь: ${row.owner_username}`;
      } else {
        ownerName.textContent = 'Старая запись';
        card.classList.add('legacy');
      }

      const canManage = Boolean(session) && (row.is_own || row.owner_username === null);

      if (row.is_own) card.classList.add('is-own');
      actions.hidden = !canManage;

      fragment.querySelector('.move-btn').addEventListener('click', async () => {
        try {
          await rpc('queue_move_v4', {
            p_id: Number(row.id),
            p_session_token: session.token
          });
          setMsg(message, `${row.surname}: перенесён в конец`, 'success');
          await loadQueues();
        } catch (error) {
          if (friendlyError(error).includes('Сессия')) saveSession(null);
          setMsg(message, friendlyError(error), 'error');
        }
      });

      fragment.querySelector('.done-btn').addEventListener('click', async () => {
        try {
          await rpc('queue_done_v4', {
            p_id: Number(row.id),
            p_session_token: session.token
          });
          setMsg(message, `${row.surname}: удалён из очереди`, 'success');
          await loadQueues();
        } catch (error) {
          if (friendlyError(error).includes('Сессия')) saveSession(null);
          setMsg(message, friendlyError(error), 'error');
        }
      });

      host.appendChild(fragment);
    });
  }

  async function loadQueues() {
    try {
      const rows = await rpc('queue_get_v4', {
        p_session_token: session?.token || null
      });
      renderQueue('1', (rows || []).filter(r => Number(r.teacher) === 1));
      renderQueue('2', (rows || []).filter(r => Number(r.teacher) === 2));
    } catch (error) {
      setMsg(message, friendlyError(error), 'error');
    }
  }

  joinForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!session) return;

    const surname = surnameInput.value.trim();
    const teacher = Number(teacherSelect.value);

    try {
      await rpc('queue_join_v4', {
        p_surname: surname,
        p_teacher: teacher,
        p_session_token: session.token
      });

      surnameInput.value = '';
      setMsg(message, `${surname}: добавлен в очередь`, 'success');
      await loadQueues();
    } catch (error) {
      const friendly = friendlyError(error);
      if (friendly.includes('Сессия')) saveSession(null);
      setMsg(message, friendly, 'error');
    }
  });

  updateAuthUi();
  loadQueues();
  setInterval(loadQueues, 3000);
})();
