export type Subscription = {
  channelId: string;
  title: string;
  thumbnail: string;
};

export type Video = {
  id: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnail: string;
  /** ISO-8601 duration, e.g. "PT4M13S". Absent if the video is unavailable. */
  duration?: string;
  durationSeconds?: number;
  isShort?: boolean;
  viewCount?: number;
  likeCount?: number;
  tags?: string[];
  /** false when the uploader has disabled embedding — we fall back to a link. */
  embeddable?: boolean;
};

export type ChannelDetail = {
  channelId: string;
  title: string;
  description: string;
  thumbnail: string;
  banner?: string;
  subscriberCount?: number;
  videoCount?: number;
};

export type Feed = {
  videos: Video[];
  subscriptions: Subscription[];
  fetchedAt: number;
  /** Channels whose uploads could not be read this round (deleted, private, errored). */
  failedChannels: string[];
  quotaUnitsUsed: number;
};
