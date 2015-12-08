import { dsl, SetRule, ConditionalRule, NotRule, OrRule, CopyCodec, MKVFormat, DTSCodec, AC3Codec, AACCodec, H264Codec }
		from '../../Server/Transcoders/Common';

export default function transcoder () {
	let domain = [ SetRule, ConditionalRule, NotRule, OrRule, CopyCodec, MKVFormat, DTSCodec, AC3Codec, AACCodec, H264Codec ];

	return dsl( domain, ( set, cond, not, or, copy, mkv, dts, ac3, aac, h264 ) => {
		return set( [
			cond( not( or( ac3(), aac() ) ), ac3() ),
			cond( not( or( h264() ) ), h264() )
		], {
			prepend: [ copy() ],
			append: [ mkv() ]
		} );
	} );
}