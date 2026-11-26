<?php

namespace App\Services;

use Google\Client as GoogleClient;
use RuntimeException;
use Throwable;

class GoogleClientTokenVerifier implements GoogleTokenVerifier
{
    public function __construct(private readonly string $clientId) {}

    /**
     * {@inheritdoc}
     */
    public function verify(string $idToken): ?array
    {
        if ($this->clientId === '') {
            throw new RuntimeException('GOOGLE_CLIENT_ID no está configurado.');
        }

        $client = new GoogleClient;
        $client->setClientId($this->clientId);

        try {
            $payload = $client->verifyIdToken($idToken);
        } catch (Throwable $e) {
            report($e);

            return null;
        }

        if (! is_array($payload)) {
            return null;
        }

        if (($payload['aud'] ?? null) !== $this->clientId) {
            return null;
        }

        return $payload;
    }
}
