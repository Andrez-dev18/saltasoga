<?php

namespace Tests\Feature;

use App\Models\JumpSession;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class JumpSessionApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_sessions_and_stats_require_authentication(): void
    {
        $this->getJson('/api/sessions')->assertStatus(401);
        $this->postJson('/api/sessions', [
            'duration_seconds' => 60,
            'total_jumps' => 100,
        ])->assertStatus(401);
        $this->getJson('/api/stats')->assertStatus(401);
    }

    public function test_sessions_are_isolated_per_user(): void
    {
        $userA = User::factory()->create();
        $userB = User::factory()->create();

        // Crear sesión para A intentando suplantar user_id de B
        $createRes = $this->actingAs($userA, 'sanctum')->postJson('/api/sessions', [
            'duration_seconds' => 120,
            'total_jumps' => 180,
            'avg_spm' => 90,
            'calories' => 32.4,
            'user_id' => $userB->id,
        ]);

        $createRes->assertStatus(201)
            ->assertJsonPath('data.user_id', $userA->id);

        JumpSession::create([
            'user_id' => $userB->id,
            'duration_seconds' => 60,
            'total_jumps' => 50,
            'avg_spm' => 50,
            'calories' => 9.0,
            'completed_at' => now(),
        ]);

        // A solo ve su sesión
        $this->actingAs($userA, 'sanctum')
            ->getJson('/api/sessions')
            ->assertStatus(200)
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.total_jumps', 180);

        // B solo ve su sesión
        $this->actingAs($userB, 'sanctum')
            ->getJson('/api/sessions')
            ->assertStatus(200)
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.total_jumps', 50);
    }

    public function test_user_cannot_view_or_delete_other_users_session(): void
    {
        $userA = User::factory()->create();
        $userB = User::factory()->create();

        $sessionB = JumpSession::create([
            'user_id' => $userB->id,
            'duration_seconds' => 90,
            'total_jumps' => 110,
            'avg_spm' => 73,
            'calories' => 19.8,
            'completed_at' => now(),
        ]);

        $this->actingAs($userA, 'sanctum')
            ->getJson("/api/sessions/{$sessionB->id}")
            ->assertStatus(403);

        $this->actingAs($userA, 'sanctum')
            ->deleteJson("/api/sessions/{$sessionB->id}")
            ->assertStatus(403);

        $this->actingAs($userB, 'sanctum')
            ->deleteJson("/api/sessions/{$sessionB->id}")
            ->assertStatus(200);

        $this->assertDatabaseMissing('jump_sessions', ['id' => $sessionB->id]);
    }

    public function test_stats_returns_aggregated_metrics_for_authenticated_user(): void
    {
        $user = User::factory()->create();
        $otherUser = User::factory()->create();

        JumpSession::create([
            'user_id' => $user->id,
            'duration_seconds' => 60,
            'total_jumps' => 100,
            'avg_spm' => 100,
            'calories' => 18.0,
            'completed_at' => now(),
        ]);

        JumpSession::create([
            'user_id' => $user->id,
            'duration_seconds' => 120,
            'total_jumps' => 240,
            'avg_spm' => 120,
            'calories' => 43.2,
            'completed_at' => now()->subDays(10),
        ]);

        JumpSession::create([
            'user_id' => $otherUser->id,
            'duration_seconds' => 999,
            'total_jumps' => 9999,
            'avg_spm' => 200,
            'calories' => 999.0,
            'completed_at' => now(),
        ]);

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/stats')
            ->assertStatus(200)
            ->assertJsonPath('data.total_sessions', 2)
            ->assertJsonPath('data.total_jumps', 340)
            ->assertJsonPath('data.total_duration_seconds', 180)
            ->assertJsonPath('data.total_calories', 61.2)
            ->assertJsonPath('data.avg_spm', 110)
            ->assertJsonPath('data.best_session_jumps', 240)
            ->assertJsonPath('data.best_spm', 120)
            ->assertJsonPath('data.best_duration_seconds', 120)
            ->assertJsonPath('data.last_7_days.sessions', 1)
            ->assertJsonPath('data.last_7_days.total_jumps', 100);
    }
}
