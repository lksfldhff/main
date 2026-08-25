<?php
/**
 * Protokoll ansehen: was wurde auf der Seite eingegeben, was kam heraus.
 *
 * Gehoert in denselben Ordner wie api.php. Die api.php schreibt jede Anfrage
 * in bernie-log.php mit; diese Seite zeigt sie an.
 *
 * ---------------------------------------------------------------------------
 * OHNE PASSWORT ZEIGT DIESE SEITE NICHTS. Unten ein Passwort eintragen,
 * sonst bleibt das Protokoll verschlossen -- die Eintraege enthalten alles,
 * was Leute eingetippt haben.
 * ---------------------------------------------------------------------------
 */

declare(strict_types=1);

// ============================== Einstellungen ==============================

/** Passwort fuer diese Seite. Leer = Protokoll bleibt gesperrt. */
$PASSWORT = getenv('BERNIE_LOG_PASSWORT') ?: '';

/** So viele Eintraege werden angezeigt (neueste zuerst). */
$ANZEIGEN = 200;

/**
 * Preise je Million Tokens, nur zum Ueberschlagen. Anbieter aendern sie --
 * die Zahlen stimmen nicht ewig.
 */
const PREISE = [
    'claude-opus-5'    => [5.0, 25.0],
    'claude-sonnet-5'  => [3.0, 15.0],
    'claude-haiku-4-5' => [1.0, 5.0],
];

// ===========================================================================

$datei = __DIR__ . '/bernie-log.php';
$eingeloggt = $PASSWORT !== '' && hash_equals($PASSWORT, (string) ($_POST['passwort'] ?? ''));
$meldung = '';

if ($eingeloggt && ($_POST['tat'] ?? '') === 'leeren') {
    @unlink($datei);
    $meldung = 'Protokoll geleert.';
}

/** Liest die Eintraege, neueste zuerst. */
function eintraege_lesen(string $datei): array
{
    if (!is_readable($datei)) {
        return [];
    }
    $eintraege = [];
    foreach (file($datei, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $zeile) {
        if (str_starts_with($zeile, '<?php')) {
            continue;
        }
        $eintrag = json_decode($zeile, true);
        if (is_array($eintrag)) {
            $eintraege[] = $eintrag;
        }
    }
    return array_reverse($eintraege);
}

/** Ueberschlaegt die Kosten eines Eintrags in Cent. */
function kosten_cent(array $eintrag): ?float
{
    $preis = PREISE[$eintrag['modell'] ?? ''] ?? null;
    if ($preis === null) {
        return null;
    }
    $dollar = ($eintrag['tokens_hinein'] ?? 0) / 1e6 * $preis[0]
            + ($eintrag['tokens_heraus'] ?? 0) / 1e6 * $preis[1];
    return $dollar * 100;
}

$eintraege = $eingeloggt ? array_slice(eintraege_lesen($datei), 0, $ANZEIGEN) : [];
$gelungen = array_filter($eintraege, static fn(array $e): bool => !empty($e['gelungen']));
$summe = 0.0;
$unbekannt = false;
foreach ($gelungen as $eintrag) {
    $cent = kosten_cent($eintrag);
    if ($cent === null) {
        $unbekannt = true;
    } else {
        $summe += $cent;
    }
}

/** Kuerzt lange Texte fuer die Vorschau. */
function kurz(string $text, int $zeichen = 400): string
{
    return mb_strlen($text) > $zeichen ? mb_substr($text, 0, $zeichen) . ' …' : $text;
}

function zeit(string $roh): string
{
    $zeitpunkt = strtotime($roh);
    return $zeitpunkt ? date('d.m.Y H:i', $zeitpunkt) : $roh;
}

$h = static fn(?string $text): string => htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Protokoll · Bernie Speaks</title>
<style>
  :root {
    --grund: oklch(0.968 0.008 80);
    --flaeche: oklch(0.99 0.004 80);
    --linie: oklch(0.89 0.008 70);
    --schrift: oklch(0.24 0.012 60);
    --leise: oklch(0.56 0.012 60);
    --zart: oklch(0.68 0.012 70);
    --akzent: oklch(0.47 0.085 50);
    --warnung: oklch(0.48 0.12 25);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--grund); color: var(--schrift);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    font-size: 15px; line-height: 1.55;
  }
  .huelle { max-width: 900px; margin: 0 auto; padding: 28px 20px 60px; }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 6px; }
  .marke {
    width: 38px; height: 38px; flex: none; border-radius: 11px; background: var(--akzent);
    display: grid; place-items: center; font-size: 20px;
  }
  h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.019em; }
  .leise { color: var(--leise); font-size: 13px; }
  .kasten {
    background: var(--flaeche); border: 1px solid var(--linie); border-radius: 12px;
    padding: 18px 20px; margin-top: 18px;
  }
  .zahlen { display: flex; flex-wrap: wrap; gap: 26px; margin-top: 18px; }
  .zahl b { display: block; font-size: 24px; font-weight: 600; letter-spacing: -0.02em; }
  .zahl span { font-size: 12.5px; color: var(--leise); }
  input[type=password] {
    border: 1px solid var(--linie); border-radius: 8px; padding: 9px 12px;
    font: inherit; font-size: 14px; background: #fff; outline: none; min-width: 220px;
  }
  input[type=password]:focus { border-color: var(--akzent); }
  button {
    border: none; border-radius: 9px; padding: 9px 16px; font: inherit; font-size: 14px;
    font-weight: 550; color: oklch(0.985 0.004 80); background: var(--akzent); cursor: pointer;
  }
  button.zart {
    background: transparent; color: var(--leise); border: 1px solid var(--linie);
  }
  .eintrag { border-top: 1px solid var(--linie); padding: 16px 0; }
  .kopfzeile { display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline; font-size: 12.5px; color: var(--leise); }
  .kopfzeile b { color: var(--schrift); font-size: 13px; font-weight: 600; }
  .paar { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 10px; }
  .paar > div { min-width: 0; }
  .titel {
    font-size: 11px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase;
    color: var(--zart); margin-bottom: 4px;
  }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; }
  .fehlgeschlagen { color: var(--warnung); }
  @media (max-width: 700px) { .paar { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="huelle">

<header>
  <div class="marke">🐎</div>
  <div>
    <h1>Protokoll</h1>
    <div class="leise">Was auf der Seite eingegeben wurde</div>
  </div>
</header>

<?php if ($PASSWORT === ''): ?>
  <div class="kasten">
    <strong>Das Protokoll ist gesperrt.</strong>
    <p class="leise">
      In <code>log.php</code> oben ein Passwort bei <code>$PASSWORT</code> eintragen
      (oder die Umgebungsvariable <code>BERNIE_LOG_PASSWORT</code> setzen). Ohne Passwort
      zeigt diese Seite nichts an — die Eintr&auml;ge enthalten alles, was Leute eingetippt haben.
    </p>
  </div>

<?php elseif (!$eingeloggt): ?>
  <div class="kasten">
    <form method="post">
      <label class="leise" for="passwort">Passwort</label><br>
      <div style="display:flex; gap:10px; margin-top:8px; flex-wrap:wrap">
        <input type="password" name="passwort" id="passwort" autofocus>
        <button type="submit">Ansehen</button>
      </div>
      <?php if (($_POST['passwort'] ?? '') !== ''): ?>
        <p class="fehlgeschlagen" style="margin-bottom:0">Passwort stimmt nicht.</p>
      <?php endif; ?>
    </form>
  </div>

<?php else: ?>
  <?php if ($meldung !== ''): ?><div class="kasten"><?= $h($meldung) ?></div><?php endif; ?>

  <div class="kasten">
    <div class="zahlen">
      <div class="zahl"><b><?= count($eintraege) ?></b><span>Eintr&auml;ge</span></div>
      <div class="zahl"><b><?= count($gelungen) ?></b><span>davon gelungen</span></div>
      <div class="zahl">
        <b><?= number_format($summe, $summe < 10 ? 1 : 0, ',', '.') ?> ct</b>
        <span>ungef&auml;hre Kosten<?= $unbekannt ? ' (unvollst&auml;ndig)' : '' ?></span>
      </div>
      <div class="zahl">
        <b><?= array_sum(array_column($gelungen, 'tokens_heraus')) ?></b>
        <span>Tokens geschrieben</span>
      </div>
    </div>
    <form method="post" style="margin-top:16px" onsubmit="return confirm('Wirklich alle Eintr&auml;ge l&ouml;schen?')">
      <input type="hidden" name="passwort" value="<?= $h((string) $_POST['passwort']) ?>">
      <input type="hidden" name="tat" value="leeren">
      <button type="submit" class="zart">Protokoll leeren</button>
    </form>
  </div>

  <div class="kasten" style="padding-top:4px">
    <?php if (!$eintraege): ?>
      <p class="leise">Noch nichts aufgezeichnet.</p>
    <?php endif; ?>

    <?php foreach ($eintraege as $eintrag): ?>
      <?php $cent = kosten_cent($eintrag); ?>
      <div class="eintrag">
        <div class="kopfzeile">
          <b><?= $h(zeit((string) ($eintrag['zeit'] ?? ''))) ?></b>
          <span><?= $h((string) ($eintrag['modell'] ?? '')) ?></span>
          <?php if (!empty($eintrag['gelungen'])): ?>
            <span><?= (int) ($eintrag['tokens_hinein'] ?? 0) ?> rein / <?= (int) ($eintrag['tokens_heraus'] ?? 0) ?> raus</span>
            <?php if ($cent !== null): ?><span><?= number_format($cent, 1, ',', '') ?> ct</span><?php endif; ?>
            <span><?= $h((string) ($eintrag['dauer'] ?? '')) ?> s</span>
          <?php else: ?>
            <span class="fehlgeschlagen"><?= $h(kurz((string) ($eintrag['fehler'] ?? 'fehlgeschlagen'), 160)) ?></span>
          <?php endif; ?>
          <span style="margin-left:auto">#<?= $h((string) ($eintrag['absender'] ?? '')) ?></span>
        </div>

        <div class="paar">
          <div>
            <div class="titel">Eingegeben</div>
            <div class="text"><?= $h(kurz((string) ($eintrag['eingabe'] ?? ''))) ?></div>
          </div>
          <?php if (!empty($eintrag['ausgabe'])): ?>
            <div>
              <div class="titel">Herausgekommen</div>
              <div class="text"><?= $h(kurz((string) $eintrag['ausgabe'])) ?></div>
            </div>
          <?php endif; ?>
        </div>
      </div>
    <?php endforeach; ?>
  </div>

  <p class="leise" style="margin-top:18px">
    Die Kostenangabe ist ein &Uuml;berschlag aus den gemeldeten Tokens und einer fest
    eingetragenen Preistabelle. Verbindlich ist allein die Abrechnung des Anbieters.
    Aufgehoben werden die letzten 500 Eintr&auml;ge; &auml;ltere fallen weg.
    Das Feld hinter dem Rautezeichen ist eine Kurzform der Absenderadresse, kein Klarname.
  </p>
<?php endif; ?>

</div>
</body>
</html>
