import evolutionApiService from '../../services/EvolutionApiService';

class SparkMessagingService {
  async enviarGrupo(instance: string, groupJid: string, texto: string): Promise<void> {
    await evolutionApiService.sendText(instance, groupJid, texto);
  }

  async enviarImagemGrupo(
    instance: string,
    groupJid: string,
    imageUrl: string,
    caption: string
  ): Promise<void> {
    await evolutionApiService.sendMedia(instance, groupJid, {
      mediatype: 'image',
      media: imageUrl,
      caption,
    });
  }

  async enviarGrupoComMencao(
    instance: string,
    groupJid: string,
    texto: string,
    mentionedJid: string
  ): Promise<void> {
    await evolutionApiService.sendTextWithMention(instance, groupJid, texto, mentionedJid);
  }

  async enviarDM(instance: string, jid: string, texto: string): Promise<void> {
    await evolutionApiService.sendText(instance, jid, texto);
  }
}

export default new SparkMessagingService();
