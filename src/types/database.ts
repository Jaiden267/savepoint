/**
 * GENERATED — via `supabase gen types typescript --linked`, against the live
 * project after all 18 migrations were confirmed applied (local/remote
 * migration history verified matching via `supabase migration list`).
 *
 * Migration 18 (`20260812100000_add_igdb_game_metadata.sql`, Prompt 3) added
 * `game_modes`, `themes`, `game_game_modes`, `game_themes` and 7 columns on
 * `games` (`igdb_game_type_id`, `igdb_game_type`, `version_parent_igdb_id`,
 * `keywords`, `developer_names`, `publisher_names`, `websites`). Those were
 * hand-patched into this file ahead of the migration being live so the app
 * could typecheck; once the user confirmed migration 18 applied, this file
 * was regenerated for real and diffed against the hand-patch first —
 * **byte-identical**, confirming the earlier patch was accurate. No manual
 * patch remains — this is a plain, unmodified `supabase gen types` output.
 *
 * Regenerate the same way after any future migration:
 *   supabase gen types typescript --linked > src/types/database.ts
 * (or `--local` after `supabase start` + `supabase migration up`, if
 * developing against a local Postgres instance).
 *
 * Note: columns backed by a `text ... check (col in (...))` constraint
 * (`user_games.status`, `lists.visibility`, `activity_events.event_type`/
 * `object_type`, `recommendation_feedback.event_type`,
 * `game_vector_sync.status`) come back here as plain `string`, not a
 * literal union — Postgres/PostgREST only expose a narrower type for a real
 * `CREATE TYPE ... AS ENUM`, which this schema deliberately doesn't use (see
 * docs/DATABASE.md). Validate the actual allowed values with a Zod schema at
 * the application boundary, not by relying on this file.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      activity_events: {
        Row: {
          actor_id: string;
          created_at: string;
          event_type: string;
          game_id: string | null;
          id: string;
          metadata: Json;
          object_id: string;
          object_type: string;
        };
        Insert: {
          actor_id: string;
          created_at?: string;
          event_type: string;
          game_id?: string | null;
          id?: string;
          metadata?: Json;
          object_id: string;
          object_type: string;
        };
        Update: {
          actor_id?: string;
          created_at?: string;
          event_type?: string;
          game_id?: string | null;
          id?: string;
          metadata?: Json;
          object_id?: string;
          object_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activity_events_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
        ];
      };
      diary_entries: {
        Row: {
          created_at: string;
          game_id: string;
          id: string;
          is_replay: boolean;
          note: string | null;
          played_on: string;
          rating: number | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          game_id: string;
          id?: string;
          is_replay?: boolean;
          note?: string | null;
          played_on?: string;
          rating?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          game_id?: string;
          id?: string;
          is_replay?: boolean;
          note?: string | null;
          played_on?: string;
          rating?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "diary_entries_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
        ];
      };
      follows: {
        Row: {
          created_at: string;
          follower_id: string;
          following_id: string;
          id: string;
        };
        Insert: {
          created_at?: string;
          follower_id?: string;
          following_id: string;
          id?: string;
        };
        Update: {
          created_at?: string;
          follower_id?: string;
          following_id?: string;
          id?: string;
        };
        Relationships: [];
      };
      game_game_modes: {
        Row: {
          game_id: string;
          game_mode_id: number;
        };
        Insert: {
          game_id: string;
          game_mode_id: number;
        };
        Update: {
          game_id?: string;
          game_mode_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "game_game_modes_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "game_game_modes_game_mode_id_fkey";
            columns: ["game_mode_id"];
            isOneToOne: false;
            referencedRelation: "game_modes";
            referencedColumns: ["id"];
          },
        ];
      };
      game_genres: {
        Row: {
          game_id: string;
          genre_id: number;
        };
        Insert: {
          game_id: string;
          genre_id: number;
        };
        Update: {
          game_id?: string;
          genre_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "game_genres_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "game_genres_genre_id_fkey";
            columns: ["genre_id"];
            isOneToOne: false;
            referencedRelation: "genres";
            referencedColumns: ["id"];
          },
        ];
      };
      game_modes: {
        Row: {
          id: number;
          name: string;
          slug: string;
        };
        Insert: {
          id: number;
          name: string;
          slug: string;
        };
        Update: {
          id?: number;
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      game_platforms: {
        Row: {
          game_id: string;
          platform_id: number;
        };
        Insert: {
          game_id: string;
          platform_id: number;
        };
        Update: {
          game_id?: string;
          platform_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "game_platforms_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "game_platforms_platform_id_fkey";
            columns: ["platform_id"];
            isOneToOne: false;
            referencedRelation: "platforms";
            referencedColumns: ["id"];
          },
        ];
      };
      game_themes: {
        Row: {
          game_id: string;
          theme_id: number;
        };
        Insert: {
          game_id: string;
          theme_id: number;
        };
        Update: {
          game_id?: string;
          theme_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "game_themes_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "game_themes_theme_id_fkey";
            columns: ["theme_id"];
            isOneToOne: false;
            referencedRelation: "themes";
            referencedColumns: ["id"];
          },
        ];
      };
      game_vector_sync: {
        Row: {
          attempt_count: number;
          error: string | null;
          game_id: string;
          last_attempted_at: string | null;
          last_synced_at: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          error?: string | null;
          game_id: string;
          last_attempted_at?: string | null;
          last_synced_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          error?: string | null;
          game_id?: string;
          last_attempted_at?: string | null;
          last_synced_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "game_vector_sync_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: true;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
        ];
      };
      games: {
        Row: {
          artwork_image_ids: string[];
          cover_image_id: string | null;
          created_at: string;
          developer_names: string[];
          id: string;
          igdb_aggregated_rating: number | null;
          igdb_aggregated_rating_count: number | null;
          igdb_game_type: string | null;
          igdb_game_type_id: number | null;
          igdb_id: number;
          igdb_rating: number | null;
          igdb_rating_count: number | null;
          igdb_synced_at: string | null;
          keywords: string[];
          name: string;
          publisher_names: string[];
          release_date: string | null;
          screenshot_image_ids: string[];
          slug: string;
          storyline: string | null;
          summary: string | null;
          updated_at: string;
          version_parent_igdb_id: number | null;
          websites: Json;
        };
        Insert: {
          artwork_image_ids?: string[];
          cover_image_id?: string | null;
          created_at?: string;
          developer_names?: string[];
          id?: string;
          igdb_aggregated_rating?: number | null;
          igdb_aggregated_rating_count?: number | null;
          igdb_game_type?: string | null;
          igdb_game_type_id?: number | null;
          igdb_id: number;
          igdb_rating?: number | null;
          igdb_rating_count?: number | null;
          igdb_synced_at?: string | null;
          keywords?: string[];
          name: string;
          publisher_names?: string[];
          release_date?: string | null;
          screenshot_image_ids?: string[];
          slug: string;
          storyline?: string | null;
          summary?: string | null;
          updated_at?: string;
          version_parent_igdb_id?: number | null;
          websites?: Json;
        };
        Update: {
          artwork_image_ids?: string[];
          cover_image_id?: string | null;
          created_at?: string;
          developer_names?: string[];
          id?: string;
          igdb_aggregated_rating?: number | null;
          igdb_aggregated_rating_count?: number | null;
          igdb_game_type?: string | null;
          igdb_game_type_id?: number | null;
          igdb_id?: number;
          igdb_rating?: number | null;
          igdb_rating_count?: number | null;
          igdb_synced_at?: string | null;
          keywords?: string[];
          name?: string;
          publisher_names?: string[];
          release_date?: string | null;
          screenshot_image_ids?: string[];
          slug?: string;
          storyline?: string | null;
          summary?: string | null;
          updated_at?: string;
          version_parent_igdb_id?: number | null;
          websites?: Json;
        };
        Relationships: [];
      };
      genres: {
        Row: {
          id: number;
          name: string;
          slug: string;
        };
        Insert: {
          id: number;
          name: string;
          slug: string;
        };
        Update: {
          id?: number;
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      list_items: {
        Row: {
          created_at: string;
          game_id: string;
          id: string;
          list_id: string;
          note: string | null;
          position: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          game_id: string;
          id?: string;
          list_id: string;
          note?: string | null;
          position: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          game_id?: string;
          id?: string;
          list_id?: string;
          note?: string | null;
          position?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "list_items_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "list_items_list_id_fkey";
            columns: ["list_id"];
            isOneToOne: false;
            referencedRelation: "lists";
            referencedColumns: ["id"];
          },
        ];
      };
      lists: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          is_ranked: boolean;
          title: string;
          updated_at: string;
          user_id: string;
          visibility: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_ranked?: boolean;
          title: string;
          updated_at?: string;
          user_id?: string;
          visibility?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_ranked?: boolean;
          title?: string;
          updated_at?: string;
          user_id?: string;
          visibility?: string;
        };
        Relationships: [];
      };
      platforms: {
        Row: {
          id: number;
          name: string;
          slug: string;
        };
        Insert: {
          id: number;
          name: string;
          slug: string;
        };
        Update: {
          id?: number;
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_path: string | null;
          bio: string | null;
          created_at: string;
          display_name: string | null;
          id: string;
          onboarding_completed_at: string | null;
          updated_at: string;
          username: string;
        };
        Insert: {
          avatar_path?: string | null;
          bio?: string | null;
          created_at?: string;
          display_name?: string | null;
          id: string;
          onboarding_completed_at?: string | null;
          updated_at?: string;
          username: string;
        };
        Update: {
          avatar_path?: string | null;
          bio?: string | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          onboarding_completed_at?: string | null;
          updated_at?: string;
          username?: string;
        };
        Relationships: [];
      };
      recommendation_feedback: {
        Row: {
          created_at: string;
          event_type: string;
          game_id: string;
          id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          event_type: string;
          game_id: string;
          id?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          event_type?: string;
          game_id?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recommendation_feedback_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
        ];
      };
      review_comments: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          review_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          review_id: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          review_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "review_comments_review_id_fkey";
            columns: ["review_id"];
            isOneToOne: false;
            referencedRelation: "reviews";
            referencedColumns: ["id"];
          },
        ];
      };
      review_likes: {
        Row: {
          created_at: string;
          review_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          review_id: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          review_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "review_likes_review_id_fkey";
            columns: ["review_id"];
            isOneToOne: false;
            referencedRelation: "reviews";
            referencedColumns: ["id"];
          },
        ];
      };
      reviews: {
        Row: {
          body: string;
          created_at: string;
          game_id: string;
          has_spoilers: boolean;
          id: string;
          rating: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          game_id: string;
          has_spoilers?: boolean;
          id?: string;
          rating: number;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          game_id?: string;
          has_spoilers?: boolean;
          id?: string;
          rating?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reviews_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
        ];
      };
      themes: {
        Row: {
          id: number;
          name: string;
          slug: string;
        };
        Insert: {
          id: number;
          name: string;
          slug: string;
        };
        Update: {
          id?: number;
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      user_games: {
        Row: {
          created_at: string;
          game_id: string;
          id: string;
          rating: number | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          game_id: string;
          id?: string;
          rating?: number | null;
          status: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          game_id?: string;
          id?: string;
          rating?: number | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_games_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      game_rating_stats: {
        Row: {
          average_rating: number | null;
          game_id: string | null;
          rating_count: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "user_games_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
        ];
      };
      profile_stats: {
        Row: {
          follower_count: number | null;
          following_count: number | null;
          games_completed: number | null;
          list_count: number | null;
          review_count: number | null;
          user_id: string | null;
        };
        Relationships: [];
      };
      review_like_counts: {
        Row: {
          like_count: number | null;
          review_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "review_likes_review_id_fkey";
            columns: ["review_id"];
            isOneToOne: false;
            referencedRelation: "reviews";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
