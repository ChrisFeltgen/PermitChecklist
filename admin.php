<?php
require __DIR__ . '/api/auth.php';
$currentAdminUser = require_admin_auth();
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Permit Checklist Admin</title>
  <link rel="shortcut icon" type="image/x-icon" href="https://www.pompanobeachfl.gov/pompanobeachfl/assets/images/favicon.ico?v=2">
  <link href="https://legacy.pompanobeachfl.gov/assets/css/03_page_specific/internal/tailwind.css" rel="stylesheet">
  <link rel="stylesheet" href="admin.css">
</head>
<body class="bg-gray-50">
  <header class="city-site-header no-print">
    <a class="show-on-focus" href="#adminContent">Skip to Content</a>

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

      <nav class="city-nav" aria-label="Admin navigation">
        <a href="index.html">Checklists</a>
        <a href="#" id="logoutButton">Log Out</a>
      </nav>
    </div>

    <div class="city-dept-bar" aria-label="Building Department breadcrumb">
      <div class="city-dept-bar__inner">
        <a href="index.html">Permit Checklists</a>
        <span class="city-dept-bar__separator" aria-hidden="true">/</span>
        <span>Admin</span>
        <span class="city-dept-bar__separator" aria-hidden="true">/</span>
        <span id="currentUserLabel"></span>
      </div>
    </div>
  </header>

  <main class="admin-shell" id="adminContent">
    <nav class="tabs" id="tabs">
      <button class="tab" data-tab="checklists" type="button">Checklists</button>
      <button class="tab" data-tab="library" type="button">Library</button>
      <button class="tab" data-tab="users" type="button">Users</button>
    </nav>

    <div id="toast" class="toast" hidden></div>

    <!-- Checklists -->
    <div class="tab-panel" id="panel-checklists" hidden>
      <div class="split">
        <div class="split__side">
          <div class="side-toolbar">
            <input id="permitSearch" type="search" placeholder="Search checklists...">
            <button id="newPermitBtn" class="btn btn--primary btn--small" type="button" hidden>+ New</button>
          </div>
          <ul class="item-list" id="permitList"></ul>
        </div>
        <div class="split__main" id="permitEditor">
          <p class="empty-state">Select a checklist on the left, or create a new one.</p>
        </div>
      </div>
    </div>

    <!-- Library -->
    <div class="tab-panel" id="panel-library" hidden>
      <div class="split">
        <div class="split__side">
          <div class="side-toolbar">
            <input id="librarySearch" type="search" placeholder="Search library...">
            <button id="newLibraryBtn" class="btn btn--primary btn--small" type="button" hidden>+ New</button>
          </div>
          <ul class="item-list" id="libraryList"></ul>
        </div>
        <div class="split__main" id="libraryEditor">
          <p class="empty-state">Select a library item on the left, or create a new one.</p>
        </div>
      </div>
    </div>

    <!-- Users -->
    <div class="tab-panel" id="panel-users" hidden>
      <div class="users-layout">
        <div>
          <h2>Users</h2>
          <table class="data-table" id="usersTable">
            <thead>
              <tr><th>Username</th><th>Role</th><th></th></tr>
            </thead>
            <tbody id="usersTableBody"></tbody>
          </table>
          <p class="form-error" id="usersTableError" hidden></p>
        </div>
        <form id="newUserForm" class="card-form">
          <h2>Add user</h2>
          <label>Username
            <input id="newUserUsername" name="username" required autocomplete="off" minlength="2" maxlength="40" pattern="[A-Za-z0-9_.\-]+">
          </label>
          <label>Temporary password
            <input id="newUserPassword" name="password" type="text" required minlength="8">
          </label>
          <label>Role
            <select id="newUserRole" name="role">
              <option value="limited_editor">Limited editor</option>
              <option value="full_editor">Full editor</option>
              <option value="full_admin">Full admin</option>
            </select>
          </label>
          <p class="form-error" id="newUserError" hidden></p>
          <button type="submit" class="btn btn--primary">Add user</button>
        </form>
      </div>
    </div>
  </main>

  <script>
    // Server-rendered, so admin.js has the logged-in user's identity/role
    // immediately — no extra round trip (and no flash of hidden-then-shown
    // UI) the way a client-side whoami fetch would need.
    window.__ADMIN_USER__ = <?php echo json_encode($currentAdminUser); ?>;
  </script>
  <script src="admin.js"></script>
</body>
</html>
