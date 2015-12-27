import { dsl, SetRule, ConditionalRule, ElseRule, NotRule, OrRule, CopyCodec, MKVFormat, DTSCodec, AC3Codec, AACCodec, H264Codec }
		from '../../Server/Transcoders/Common';

export default function transcoder () {
	let domain = [ SetRule, ConditionalRule, ElseRule, NotRule, OrRule, CopyCodec, MKVFormat, DTSCodec, AC3Codec, AACCodec, H264Codec ];

	return dsl( domain, ( set, ifThen, otherwise, not, or, copy, mkv, dts, ac3, aac, h264 ) => {
		return set( [
			ifThen( not( or( ac3(), aac() ) ), ac3() ),
			ifThen( not( or( h264() ) ), [ h264() ], otherwise( h264() ) )
		], {
			prepend: [ copy() ],
			append: [ mkv() ]
		} );
	} );
}