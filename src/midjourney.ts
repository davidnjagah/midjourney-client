import {
  DefaultMJConfig,
  DiscordImage,
  LoadingHandler,
  MJConfig,
  MJConfigParam,
} from "./interfaces";
import { MidjourneyApi } from "./midjourney.api";
import { InsightFaceSwapApi } from "./insightfaceswap.api";
import { MidjourneyMessage } from "./discord.message";
import {
  toRemixCustom,
  custom2Type,
  nextNonce,
  random,
  base64ToBlob,
} from "./utils";
import { WsMessage } from "./discord.ws";
export class Midjourney extends MidjourneyMessage {
  public config: MJConfig;
  private wsClient?: WsMessage;
  public MJApi: MidjourneyApi;
  public IFSApi: InsightFaceSwapApi;
  constructor(defaults: MJConfigParam) {
    const { SalaiToken } = defaults;
    if (!SalaiToken) {
      throw new Error("SalaiToken are required");
    }
    super(defaults);
    this.config = {
      ...DefaultMJConfig,
      ...defaults,
    };
    this.MJApi = new MidjourneyApi(this.config);
    this.IFSApi = new InsightFaceSwapApi(this.config);
  }
  async Connect() {
    if (!this.config.Ws) {
      return this;
    }
    //if auth failed, will throw error
    if (this.config.ServerId) {
      await this.MJApi.getCommand("settings");
    } else {
      await this.MJApi.allCommand();
    }
    if (this.wsClient) return this;
    this.wsClient = new WsMessage(this.config, this.MJApi);
    await this.wsClient.onceReady();
    return this;
  }
  async init() {
    await this.Connect();
    const settings = await this.Settings();
    if (settings) {
      // this.log(`settings:`, settings.content);
      const remix = settings.options.find((o) => o.label === "Remix mode");
      if (remix?.style == 3) {
        this.config.Remix = true;
        this.log(`Remix mode enabled`);
      }
    }
    return this;
  }

  async Imagine(prompt: string, loading?: LoadingHandler) {
    prompt = prompt.trim();
    if (!this.config.Ws) {
      const seed = random(1000000000, 9999999999);
      prompt = `[${seed}] ${prompt}`;
    } else {
      await this.getWsClient();
    }

    const nonce = nextNonce();
    this.log(`Imagine`, prompt, "nonce", nonce);
    const httpStatus = await this.MJApi.ImagineApi(prompt, nonce);
    if (httpStatus !== 204) {
      throw new Error(`ImagineApi failed with status ${httpStatus}`);
    }
    if (this.wsClient) {
      return await this.wsClient.waitImageMessage({ nonce, loading, prompt });
    } else {
      this.log(`await generate image`);
      const msg = await this.WaitMessage(prompt, loading);
      this.log(`image generated`, prompt, msg?.uri);
      return msg;
    }
  }

  async SaveId(idname: string, imageUri: string, loading?: LoadingHandler) {
    if (!this.config.Ws) {
      const seed = random(1000000000, 9999999999);
      imageUri = `[${seed}] ${imageUri}`;
    } else {
      await this.getWsClient();
    }

    const nonce = nextNonce();
    const DcImage = await this.MJApi.UploadImageByUri(imageUri);
    const nonceid = nonce.split(' ')[0];
    const uniqueIdName = idname+nonceid;
    console.log("This is nonceid", nonceid);
    const id = `${Math.trunc(Math.random()*10000000000)}`;
    this.log(`SaveId`, id, DcImage, "nonce", nonce);
    const saveIdRes = `idname ${id} created`
    //here is where the idname will be created by merging the user id
    //with the nonce. I can tweak the waitimagemessage to wait for that.
    //then i can take the saveid and pass it to swapid. {this is what
    //was causing the midjourney bot to not continue}. For now i'll
    //hardcode the idname to test.
    
    const httpStatus = await this.IFSApi.saveIdApi(id, DcImage, nonce);
    //console.log(httpStatus);
    if (httpStatus !== 204) {
      throw new Error(`savedIdApi failed with status ${httpStatus}`);
    }
    if (this.wsClient) {
      return await this.wsClient.waitSaveIdMessage({ nonce, saveidres: saveIdRes, loading });
    } else {
      this.log(`await generate image`);
      const msg = await this.WaitMessage(saveIdRes, loading);
      this.log(`image generated`, imageUri);
      return msg;
    }
  }

  async SwapId(idname: string, imageUri: string, loading?: LoadingHandler) {
    if (!this.config.Ws) {
      const seed = random(1000000000, 9999999999);
      imageUri = `[${seed}] ${imageUri}`;
    } else {
      await this.getWsClient();
    }

    const nonce = nextNonce();
    const regex = /^(.*\.(png|jpg))/;
    const match = imageUri.match(regex);

    if (match && match[1]) {
      // Return the part of the URL up to the .png or .jpg
      imageUri = match[1];
    } else {
      // Return the original URL if no match is found (or if it doesn't end with .png)
      imageUri = imageUri;
    }
    console.log(imageUri);
    const DcImage = await this.MJApi.UploadImageByUri(imageUri);
    this.log(`SwapId`, idname, DcImage, "nonce", nonce);
    //the wait image message will be different with swap id because
    //i might want to get more than one image and for that
    //i'll have to use an extra unique varibale to check. (can use the nonce)
    //i dont need to check for loading just saveid and filename
    const httpStatus = await this.IFSApi.swapIdApi(idname, DcImage, nonce);
    //console.log(httpStatus);
    if (httpStatus !== 204) {
      throw new Error(`swapIdApi failed with status ${httpStatus}`);
    }
    if (this.wsClient) {
      return await this.wsClient.waitImageMessage({ nonce, loading, idname });
    } else {
      this.log(`await generate image`);
      const msg = await this.WaitSwapIdMessage(imageUri, loading);
      this.log(`image generated`, imageUri);
      return msg;
    }
  }

  // check ws enabled && connect
  private async getWsClient() {
    if (!this.config.Ws) {
      throw new Error(`ws not enabled`);
    }
    if (!this.wsClient) {
      await this.Connect();
    }
    if (!this.wsClient) {
      throw new Error(`ws not connected`);
    }
    return this.wsClient;
  }



  async Settings() {
    const wsClient = await this.getWsClient();
    const nonce = nextNonce();
    const httpStatus = await this.MJApi.SettingsApi(nonce);
    if (httpStatus !== 204) {
      throw new Error(`ImagineApi failed with status ${httpStatus}`);
    }
    return wsClient.waitSettings();
  }
  async Reset() {
    const settings = await this.Settings();
    if (!settings) {
      throw new Error(`Settings not found`);
    }
    const reset = settings.options.find((o) => o.label === "Reset Settings");
    if (!reset) {
      throw new Error(`Reset Settings not found`);
    }
    const httpstatus = await this.MJApi.CustomApi({
      msgId: settings.id,
      customId: reset.custom,
      flags: settings.flags,
    });
    if (httpstatus !== 204) {
      throw new Error(`Reset failed with status ${httpstatus}`);
    }
  }

  async Info() {
    const wsClient = await this.getWsClient();
    const nonce = nextNonce();
    const httpStatus = await this.MJApi.InfoApi(nonce);
    console.log(httpStatus);
    if (httpStatus !== 204) {
      throw new Error(`InfoApi failed with status ${httpStatus}`);
    }
    return wsClient.waitInfo();
  }

  async Fast() {
    const nonce = nextNonce();
    const httpStatus = await this.MJApi.FastApi(nonce);
    if (httpStatus !== 204) {
      throw new Error(`FastApi failed with status ${httpStatus}`);
    }
    return null;
  }
  async Relax() {
    const nonce = nextNonce();
    const httpStatus = await this.MJApi.RelaxApi(nonce);
    if (httpStatus !== 204) {
      throw new Error(`RelaxApi failed with status ${httpStatus}`);
    }
    return null;
  }
  async SwitchRemix() {
    const wsClient = await this.getWsClient();
    const nonce = nextNonce();
    const httpStatus = await this.MJApi.SwitchRemixApi(nonce);
    if (httpStatus !== 204) {
      throw new Error(`RelaxApi failed with status ${httpStatus}`);
    }
    return wsClient.waitContent("prefer-remix");
  }
  async Describe(imgUri: string) {
    const wsClient = await this.getWsClient();
    const nonce = nextNonce();
    const DcImage = await this.MJApi.UploadImageByUri(imgUri);
    this.log(`Describe`, DcImage);
    const httpStatus = await this.MJApi.DescribeApi(DcImage, nonce);
    if (httpStatus !== 204) {
      throw new Error(`DescribeApi failed with status ${httpStatus}`);
    }
    return wsClient.waitDescribe(nonce);
  }
  async DescribeByBlob(blob: Blob) {
    const wsClient = await this.getWsClient();
    const nonce = nextNonce();
    const DcImage = await this.MJApi.UploadImageByBole(blob);
    this.log(`Describe`, DcImage);
    const httpStatus = await this.MJApi.DescribeApi(DcImage, nonce);
    if (httpStatus !== 204) {
      throw new Error(`DescribeApi failed with status ${httpStatus}`);
    }
    return wsClient.waitDescribe(nonce);
  }

  async Shorten(prompt: string) {
    const wsClient = await this.getWsClient();
    const nonce = nextNonce();
    const httpStatus = await this.MJApi.ShortenApi(prompt, nonce);
    if (httpStatus !== 204) {
      throw new Error(`ShortenApi failed with status ${httpStatus}`);
    }
    return wsClient.waitShorten(nonce);
  }

  async Variation({
    index,
    msgId,
    hash,
    content,
    flags,
    loading,
  }: {
    index: 1 | 2 | 3 | 4;
    msgId: string;
    hash: string;
    content?: string;
    flags: number;
    loading?: LoadingHandler;
  }) {
    return await this.Custom({
      customId: `MJ::JOB::variation::${index}::${hash}`,
      msgId,
      content,
      flags,
      loading,
    });
  }

  async Upscale({
    index,
    msgId,
    hash,
    content,
    flags,
    loading,
  }: {
    index: 1 | 2 | 3 | 4;
    msgId: string;
    hash: string;
    content?: string;
    flags: number;
    loading?: LoadingHandler;
  }) {
    return await this.Custom({
      customId: `MJ::JOB::upsample::${index}::${hash}`,
      msgId,
      content,
      flags,
      loading,
    });
  }

  async Custom({
    msgId,
    customId,
    content,
    flags,
    loading,
  }: {
    msgId: string;
    customId: string;
    content?: string;
    flags: number;
    loading?: LoadingHandler;
  }) {
    if (this.config.Ws) {
      await this.getWsClient();
    }
    const nonce = nextNonce();
    const httpStatus = await this.MJApi.CustomApi({
      msgId,
      customId,
      flags,
      nonce,
    });
    if (httpStatus !== 204) {
      throw new Error(`CustomApi failed with status ${httpStatus}`);
    }
    if (this.wsClient) {
      return await this.wsClient.waitImageMessage({
        nonce,
        loading,
        messageId: msgId,
        prompt: content,
        onmodal: async (nonde, id) => {
          if (content === undefined || content === "") {
            return "";
          }
          const newNonce = nextNonce();
          switch (custom2Type(customId)) {
            case "customZoom":
              const httpStatus = await this.MJApi.CustomZoomImagineApi({
                msgId: id,
                customId,
                prompt: content,
                nonce: newNonce,
              });
              if (httpStatus !== 204) {
                throw new Error(
                  `CustomZoomImagineApi failed with status ${httpStatus}`
                );
              }
              return newNonce;
            case "variation":
              if (this.config.Remix !== true) {
                return "";
              }
              customId = toRemixCustom(customId);
              const remixHttpStatus = await this.MJApi.RemixApi({
                msgId: id,
                customId,
                prompt: content,
                nonce: newNonce,
              });
              if (remixHttpStatus !== 204) {
                throw new Error(
                  `RemixApi failed with status ${remixHttpStatus}`
                );
              }
              return newNonce;
            default:
              return "";
              throw new Error(`unknown customId ${customId}`);
          }
        },
      });
    }
    if (content === undefined || content === "") {
      throw new Error(`content is required`);
    }
    return await this.WaitMessage(content, loading);
  }

  async ZoomOut({
    level,
    msgId,
    hash,
    content,
    flags,
    loading,
  }: {
    level: "high" | "low" | "2x" | "1.5x";
    msgId: string;
    hash: string;
    content?: string;
    flags: number;
    loading?: LoadingHandler;
  }) {
    let customId: string;
    switch (level) {
      case "high":
        customId = `MJ::JOB::high_variation::1::${hash}::SOLO`;
        break;
      case "low":
        customId = `MJ::JOB::low_variation::1::${hash}::SOLO`;
        break;
      case "2x":
        customId = `MJ::Outpaint::50::1::${hash}::SOLO`;
        break;
      case "1.5x":
        customId = `MJ::Outpaint::75::1::${hash}::SOLO`;
        break;
    }
    return this.Custom({
      msgId,
      customId,
      content,
      flags,
      loading,
    });
  }

  async Reroll({
    msgId,
    hash,
    content,
    flags,
    loading,
  }: {
    msgId: string;
    hash: string;
    content?: string;
    flags: number;
    loading?: LoadingHandler;
  }) {
    return await this.Custom({
      customId: `MJ::JOB::reroll::0::${hash}::SOLO`,
      msgId,
      content,
      flags,
      loading,
    });
  }

  Close() {
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = undefined;
    }
  }
}
