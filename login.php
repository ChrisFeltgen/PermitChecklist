<?php

declare(strict_types=1);

require_once __DIR__ . '/api/lib/authStore.php';
require_once __DIR__ . '/api/lib/session.php';

start_admin_session();

$rawNext = (string) ($_POST['next'] ?? $_GET['next'] ?? 'admin.php');
$next = is_safe_local_redirect($rawNext) ? $rawNext : 'admin.php';

// Already logged in? Don't make them log in again.
if (isset($_SESSION['user']['username'])) {
    header('Location: ' . $next);
    exit;
}

$error = '';
$username = '';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');

    $authenticatedUser = null;
    foreach (read_auth_users() as $user) {
        $expectedUser = (string) ($user['username'] ?? '');
        $expectedHash = (string) ($user['passwordHash'] ?? '');

        if ($expectedUser === '' || $expectedHash === '') {
            continue;
        }

        if (hash_equals($expectedUser, $username) && password_verify($password, $expectedHash)) {
            $authenticatedUser = [
                'username' => $expectedUser,
                'role' => normalize_role($user['role'] ?? null),
            ];
            break;
        }
    }

    if ($authenticatedUser !== null) {
        session_regenerate_id(true);
        $_SESSION['user'] = $authenticatedUser;
        header('Location: ' . $next);
        exit;
    }

    $error = 'Incorrect username or password.';
}

$nextField = htmlspecialchars($next, ENT_QUOTES);
$errorHtml = $error !== '' ? htmlspecialchars($error, ENT_QUOTES) : '';
// Repopulate the username (never the password) after a failed attempt.
$usernameField = htmlspecialchars($username, ENT_QUOTES);
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Staff Login</title>
  <link rel="shortcut icon" type="image/x-icon" href="https://www.pompanobeachfl.gov/pompanobeachfl/assets/images/favicon.ico?v=2">
  <link href="https://legacy.pompanobeachfl.gov/assets/css/03_page_specific/internal/tailwind.css" rel="stylesheet">
  <link rel="stylesheet" href="admin.css">
</head>
<body class="bg-gray-50">
  <header class="city-site-header no-print">
    <a class="show-on-focus" href="#loginContent">Skip to Content</a>

    <div class="city-site-header__main">
      <a class="city-brand" href="index.html" aria-label="Permit checklists home">
        <img
          src="https://www.pompanobeachfl.gov/pompanobeachfl/assets/images/sitewide/COPB_Logo.png"
          alt="City of Pompano Beach Logo"
          class="city-brand__logo"
        />
        <span class="city-brand__divider" aria-hidden="true"></span>
        <span class="city-brand__welcome">
          <span>Welcome to</span>
          <strong>Pompano Beach</strong>
        </span>
      </a>
      <nav class="city-nav" aria-label="Navigation">
        <a href="index.html">Checklists</a>
      </nav>
    </div>

    <div class="city-dept-bar" aria-label="Building Department breadcrumb">
      <div class="city-dept-bar__inner">
        <a href="index.html">Permit Checklists</a>
        <span class="city-dept-bar__separator" aria-hidden="true">/</span>
        <span>Staff Login</span>
      </div>
    </div>
  </header>

  <main class="login-shell" id="loginContent">
    <form class="login-card" method="post" action="login.php" autocomplete="off">
      <h1>Staff Login</h1>
      <p class="field-hint">Sign in to manage permit checklist data.</p>

      <?php if ($errorHtml !== ''): ?>
        <p class="login-error" role="alert"><?php echo $errorHtml; ?></p>
      <?php endif; ?>

      <input type="hidden" name="next" value="<?php echo $nextField; ?>" />

      <div class="field-group">
        <label for="loginUsername">Username</label>
        <input id="loginUsername" class="field-control" type="text" name="username" value="<?php echo $usernameField; ?>" required autofocus autocomplete="username" />
      </div>

      <div class="field-group">
        <label for="loginPassword">Password</label>
        <input id="loginPassword" class="field-control" type="password" name="password" required autocomplete="current-password" />
      </div>

      <button type="submit" class="primary-action">Log In</button>
    </form>
  </main>
</body>
</html>
