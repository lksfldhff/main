<?php
/**
 * Vermittler zwischen der Seite und dem Sprachmodell.
 *
 * Liegt diese Datei neben der HTML-Datei auf dem Webspace, findet die Seite
 * sie von selbst und benutzt sie. Dann gilt:
 *
 *   - Besucher brauchen KEINEN eigenen Schluessel; die Seite laeuft sofort.
 *   - Der Schluessel steht hier auf dem Server und nie im Browser.
 *   - Der Aufruf laeuft ueber die eigene Adresse, also gibt es kein CORS.
 *
 * Ohne diese Datei funktioniert die Seite weiterhin -- dann traegt jeder
 * Besucher seinen eigenen Schluessel ein.
 *
 * ---------------------------------------------------------------------------
 * WICHTIG: Wer die Adresse kennt, verbraucht das Guthaben des Schluessels.
 * Bei einer oeffentlich erreichbaren Seite unbedingt ein Zugangswort setzen
 * (BERNIE_ZUGANG) oder die Seite hinter einen Passwortschutz legen.
 * ---------------------------------------------------------------------------
 *
 * Einstellen entweder hier unten oder ueber Umgebungsvariablen.
 */

declare(strict_types=1);

// ============================== Einstellungen ==============================

/** Der API-Schluessel. Am Praefix wird der Anbieter erkannt. */
$SCHLUESSEL = getenv('BERNIE_SCHLUESSEL') ?: '';

/** Optionales Zugangswort. Leer lassen = jeder darf. */
$ZUGANG = getenv('BERNIE_ZUGANG') ?: '';

/** Abweichender Modellname; leer lassen fuer die Voreinstellung des Anbieters. */
$MODELL = getenv('BERNIE_MODELL') ?: '';

/** Hoechstens so viele Anfragen je Stunde und Absender. */
$PRO_STUNDE = 60;

/** Laengere Eingaben werden abgewiesen. */
$MAX_ZEICHEN = 20000;

// ===========================================================================

const ANBIETER = [
    ['praefix' => 'sk-ant-', 'name' => 'Claude',
     'adresse' => 'https://api.anthropic.com/v1/messages',
     'modell' => 'claude-opus-5', 'format' => 'anthropic'],
    ['praefix' => 'gsk_', 'name' => 'Groq',
     'adresse' => 'https://api.groq.com/openai/v1/chat/completions',
     'modell' => 'llama-3.3-70b-versatile', 'format' => 'openai'],
    ['praefix' => 'sk-or-', 'name' => 'OpenRouter',
     'adresse' => 'https://openrouter.ai/api/v1/chat/completions',
     'modell' => 'meta-llama/llama-3.3-70b-instruct:free', 'format' => 'openai'],
    ['praefix' => 'sk-', 'name' => 'OpenAI',
     'adresse' => 'https://api.openai.com/v1/chat/completions',
     'modell' => 'gpt-4o-mini', 'format' => 'openai'],
];

header('content-type: application/json; charset=utf-8');
header('cache-control: no-store');
header('x-content-type-options: nosniff');

/** Antwortet und beendet die Verarbeitung. */
function antworten(array $nutzlast, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($nutzlast, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function anbieter_zu(string $schluessel): ?array
{
    foreach (ANBIETER as $eintrag) {
        if (str_starts_with($schluessel, $eintrag['praefix'])) {
            return $eintrag;
        }
    }
    return null;
}

/**
 * Einfache Bremse gegen Dauerfeuer: je Absender so viele Anfragen je Stunde.
 * Reicht fuer eine kleine Seite; wer mehr braucht, nimmt einen Passwortschutz.
 */
function bremse_frei(int $pro_stunde): bool
{
    if ($pro_stunde <= 0) {
        return true;
    }
    $absender = $_SERVER['REMOTE_ADDR'] ?? 'unbekannt';
    $datei = sys_get_temp_dir() . '/bernie-' . hash('sha256', $absender) . '.txt';
    $jetzt = time();
    $zeiten = [];
    if (is_readable($datei)) {
        $roh = (array) json_decode((string) file_get_contents($datei), true);
        $zeiten = array_filter($roh, static fn($t): bool => is_int($t) && $t > $jetzt - 3600);
    }
    if (count($zeiten) >= $pro_stunde) {
        return false;
    }
    $zeiten[] = $jetzt;
    @file_put_contents($datei, json_encode(array_values($zeiten)), LOCK_EX);
    return true;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    antworten(['fehler' => 'Nur POST.'], 405);
}

$roh = file_get_contents('php://input') ?: '';
$anfrage = json_decode($roh, true);
if (!is_array($anfrage)) {
    antworten(['fehler' => 'Die Anfrage war nicht lesbar.'], 400);
}

$eintrag = anbieter_zu($SCHLUESSEL);
$bereit = $eintrag !== null;

// Die Seite fragt beim Laden, ob dieser Vermittler einsatzbereit ist.
if (!empty($anfrage['pruefen'])) {
    antworten([
        'bereit' => $bereit,
        'anbieter' => $bereit ? $eintrag['name'] : '',
        'modell' => $bereit ? ($MODELL ?: $eintrag['modell']) : '',
        'zugang_noetig' => $ZUGANG !== '',
        'grund' => $bereit ? '' : 'Auf dem Server ist kein Schluessel hinterlegt (api.php, Zeile "SCHLUESSEL").',
    ]);
}

if (!$bereit) {
    antworten(['fehler' => 'Auf dem Server ist kein gueltiger Schluessel hinterlegt.'], 503);
}
if ($ZUGANG !== '' && !hash_equals($ZUGANG, (string) ($anfrage['zugang'] ?? ''))) {
    antworten(['fehler' => 'Falsches Zugangswort.'], 401);
}
if (!bremse_frei($PRO_STUNDE)) {
    antworten(['fehler' => "Zu viele Anfragen. Hoechstens $PRO_STUNDE je Stunde."], 429);
}

$system = (string) ($anfrage['system'] ?? '');
$nutzer = (string) ($anfrage['nutzer'] ?? '');
if (trim($nutzer) === '') {
    antworten(['fehler' => 'Kein Text uebergeben.'], 400);
}
if (mb_strlen($system) + mb_strlen($nutzer) > $MAX_ZEICHEN) {
    antworten(['fehler' => 'Der Text ist zu lang.'], 413);
}

$modell = $MODELL ?: $eintrag['modell'];
if ($eintrag['format'] === 'anthropic') {
    $kopf = [
        'content-type: application/json',
        'x-api-key: ' . $SCHLUESSEL,
        'anthropic-version: 2023-06-01',
    ];
    // Die aktuellen Claude-Modelle denken von sich aus mit; gesteuert wird das
    // ueber den Aufwand. Temperatur gibt es dort nicht mehr.
    $koerper = [
        'model' => $modell,
        'max_tokens' => 8000,
        'system' => $system,
        'messages' => [['role' => 'user', 'content' => $nutzer]],
        'output_config' => ['effort' => 'medium'],
    ];
} else {
    $kopf = ['content-type: application/json', 'authorization: Bearer ' . $SCHLUESSEL];
    $koerper = [
        'model' => $modell,
        'max_tokens' => 2000,
        'messages' => [
            ['role' => 'system', 'content' => $system],
            ['role' => 'user', 'content' => $nutzer],
        ],
    ];
}

$verbindung = curl_init($eintrag['adresse']);
curl_setopt_array($verbindung, [
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => $kopf,
    CURLOPT_POSTFIELDS => json_encode($koerper, JSON_UNESCAPED_UNICODE),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 120,
]);
$antwort = curl_exec($verbindung);
$status = (int) curl_getinfo($verbindung, CURLINFO_RESPONSE_CODE);
$netzfehler = curl_error($verbindung);
curl_close($verbindung);

if ($antwort === false) {
    antworten(['fehler' => 'Keine Verbindung zum Anbieter: ' . $netzfehler], 502);
}

$daten = json_decode((string) $antwort, true);
if ($status < 200 || $status >= 300) {
    $meldung = $daten['error']['message'] ?? $daten['error'] ?? '';
    $texte = [
        400 => 'Die Anfrage wurde abgelehnt (400). Meist stimmt der Modellname nicht.',
        401 => 'Der hinterlegte Schluessel wird nicht akzeptiert (401).',
        403 => 'Zugriff verweigert (403).',
        404 => 'Modell nicht gefunden (404).',
        429 => 'Der Anbieter bremst gerade (429). Kurz warten.',
        529 => 'Der Dienst ist ueberlastet (529).',
    ];
    $text = $texte[$status] ?? "Der Anbieter antwortete mit Status $status.";
    antworten(['fehler' => $text . (is_string($meldung) && $meldung !== '' ? ' Meldung: ' . $meldung : '')], 502);
}

// Anthropic liefert Bloecke, OpenAI-kompatible Dienste "choices".
if (isset($daten['content']) && is_array($daten['content'])) {
    $teile = array_map(
        static fn(array $block): string => (string) ($block['text'] ?? ''),
        array_filter($daten['content'], static fn($b): bool => is_array($b) && ($b['type'] ?? '') === 'text')
    );
    $text = implode("\n", $teile);
} else {
    $text = (string) ($daten['choices'][0]['message']['content'] ?? '');
}

if (trim($text) === '') {
    antworten(['fehler' => 'Die Antwort des Modells war leer.'], 502);
}

antworten(['text' => trim($text), 'anbieter' => $eintrag['name'], 'modell' => $modell]);
